import { CHARGED_HEADER, createTabGate, offerBody, parseVoucher, type TabOffer, VOUCHER_HEADER } from "arc-tabs";
import { matchPaidRoute } from "./api";
import { type Env, network } from "./env";
import { durableVoucherStore } from "./ledger";
import { statsCounter } from "./stats";

export { TabLedger } from "./ledger";
export { StatsCounter } from "./stats";

const PRICE = 100_000_000_000_000n;
const MIN_REMAINING_SECONDS = 600;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    return withCors(await route(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const net = network(env);
  const offer: TabOffer = {
    chainId: net.chainId,
    contract: net.contract,
    payee: net.payee,
    price: PRICE,
    minRemainingSeconds: MIN_REMAINING_SECONDS,
  };

  if (url.pathname === "/v1/offer") return Response.json(offerBody(offer, "Open a tab on this contract, then send a voucher with each call."));
  if (url.pathname === "/v1/stats") return Response.json(await statsCounter(env.STATS).read());

  const paidRoute = matchPaidRoute(url.pathname);
  if (!paidRoute) return Response.json({ reason: "Not found." }, { status: 404 });
  if (paidRoute === "bad-request") return Response.json({ reason: "Invalid address." }, { status: 400 });

  const gate = createTabGate({ client: net.client, offer, store: durableVoucherStore(env.TAB_LEDGER) });
  const response = await gate.serve(request, async () => {
    try {
      return Response.json(await paidRoute(net));
    } catch (error) {
      console.error(error);
      return Response.json({ reason: "The Arc RPC call failed. You were not charged." }, { status: 502 });
    }
  });

  const charged = response.headers.get(CHARGED_HEADER);
  const voucher = parseVoucher(request.headers.get(VOUCHER_HEADER));
  if (charged && voucher) ctx.waitUntil(statsCounter(env.STATS).record(voucher.tabId.toString(), charged));
  return response;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Payment-Tab");
  headers.set("Access-Control-Expose-Headers", "Payment-Tab-Total, Payment-Tab-Charged");
  return new Response(response.body, { status: response.status, headers });
}
