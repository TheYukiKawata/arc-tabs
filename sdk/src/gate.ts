import type { PublicClient } from "viem";
import { offerResponse, type TabOffer } from "./offer";
import type { VoucherStore } from "./store";
import { readTab, unixNow } from "./tab";
import {
  CHARGED_HEADER,
  parseVoucher,
  TOTAL_HEADER,
  tabsDomain,
  type Voucher,
  VOUCHER_HEADER,
  voucherTypes,
} from "./voucher";

export type Payment = { voucher: Voucher; charged: bigint };

type Verification = { ok: true; payment: Payment; previous: Voucher | undefined } | { ok: false; response: Response };

export type TabGateOptions = {
  client: PublicClient;
  offer: TabOffer;
  store: VoucherStore;
};

export function createTabGate({ client, offer, store }: TabGateOptions) {
  const reject = (reason: string): Verification => ({ ok: false, response: offerResponse(offer, reason) });

  async function verify(request: Request): Promise<Verification> {
    const voucher = parseVoucher(request.headers.get(VOUCHER_HEADER));
    if (!voucher) return reject("Send a signed voucher in the Payment-Tab header.");

    const tab = await readTab(client, offer.contract, voucher.tabId);
    if (tab.payee.toLowerCase() !== offer.payee.toLowerCase()) return reject("The tab pays a different payee.");
    if (tab.expiresAt < unixNow() + BigInt(offer.minRemainingSeconds)) return reject("The tab expires too soon.");
    if (voucher.total > tab.deposit) return reject("The voucher total is above the tab deposit.");

    const previous = await store.latest(voucher.tabId);
    const previousTotal = maxOf(previous?.total ?? 0n, tab.paid);
    if (voucher.total - previousTotal < offer.price) return reject("The voucher adds less than the price.");

    const signedByTabSigner = await client.verifyTypedData({
      address: tab.signer,
      domain: tabsDomain(offer),
      types: voucherTypes,
      primaryType: "Voucher",
      message: { tabId: voucher.tabId, total: voucher.total },
      signature: voucher.signature,
    });
    if (!signedByTabSigner) return reject("The voucher signature does not match the tab signer.");

    return { ok: true, payment: { voucher, charged: voucher.total - previousTotal }, previous };
  }

  async function serve(request: Request, handler: (payment: Payment) => Promise<Response>): Promise<Response> {
    const verification = await verify(request);
    if (!verification.ok) return verification.response;

    const { payment, previous } = verification;
    const response = await handler(payment);
    if (!response.ok) return response;
    if (!(await store.replace(previous, payment.voucher))) {
      return Response.json({ reason: "Another voucher for this tab won. Retry." }, { status: 409 });
    }

    const receipt = new Response(response.body, response);
    receipt.headers.set(TOTAL_HEADER, payment.voucher.total.toString());
    receipt.headers.set(CHARGED_HEADER, payment.charged.toString());
    return receipt;
  }

  return { offer, serve };
}

function maxOf(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
