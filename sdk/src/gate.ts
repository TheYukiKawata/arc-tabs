import type { PublicClient } from "viem";
import { offerResponse, type TabOffer } from "./offer";
import type { VoucherStore } from "./store";
import { readTab, unixNow } from "./tab";
import { parseVoucher, tabsDomain, type Voucher, VOUCHER_HEADER, voucherTypes } from "./voucher";

export type Acceptance = { ok: true; voucher: Voucher; charged: bigint } | { ok: false; response: Response };

export type TabGateOptions = {
  client: PublicClient;
  offer: TabOffer;
  store: VoucherStore;
};

export function createTabGate({ client, offer, store }: TabGateOptions) {
  const reject = (reason: string): Acceptance => ({ ok: false, response: offerResponse(offer, reason) });

  async function accept(request: Request): Promise<Acceptance> {
    const voucher = parseVoucher(request.headers.get(VOUCHER_HEADER));
    if (!voucher) return reject("Send a signed voucher in the Payment-Tab header.");

    const tab = await readTab(client, offer.contract, voucher.tabId);
    if (tab.payee.toLowerCase() !== offer.payee.toLowerCase()) return reject("The tab pays a different payee.");
    if (tab.expiresAt < unixNow() + BigInt(offer.minRemainingSeconds)) return reject("The tab expires too soon.");
    if (voucher.total > tab.deposit) return reject("The voucher total is above the tab deposit.");

    const latest = await store.latest(voucher.tabId);
    const previousTotal = maxOf(latest?.total ?? 0n, tab.paid);
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

    if (!(await store.replace(latest, voucher))) {
      return { ok: false, response: Response.json({ reason: "Another voucher for this tab won. Retry." }, { status: 409 }) };
    }
    return { ok: true, voucher, charged: voucher.total - previousTotal };
  }

  return { offer, accept };
}

function maxOf(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
