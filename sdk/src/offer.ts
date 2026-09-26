import { type Address, isAddress } from "viem";
import type { TabsDeployment } from "./voucher";

export const OFFER_SCHEME = "arc-tab";

export type TabOffer = TabsDeployment & {
  payee: Address;
  price: bigint;
  minRemainingSeconds: number;
};

export type OfferBody = {
  scheme: typeof OFFER_SCHEME;
  chainId: number;
  contract: Address;
  payee: Address;
  price: string;
  minRemainingSeconds: number;
  reason: string;
};

export function offerBody(offer: TabOffer, reason: string): OfferBody {
  return {
    scheme: OFFER_SCHEME,
    chainId: offer.chainId,
    contract: offer.contract,
    payee: offer.payee,
    price: offer.price.toString(),
    minRemainingSeconds: offer.minRemainingSeconds,
    reason,
  };
}

export function offerResponse(offer: TabOffer, reason: string): Response {
  return Response.json(offerBody(offer, reason), { status: 402 });
}

export function parseOffer(body: unknown): TabOffer | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  if (candidate.scheme !== OFFER_SCHEME) return undefined;

  const { chainId, contract, payee, price, minRemainingSeconds } = candidate;
  if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(minRemainingSeconds)) return undefined;
  if (typeof contract !== "string" || !isAddress(contract)) return undefined;
  if (typeof payee !== "string" || !isAddress(payee)) return undefined;
  if (typeof price !== "string" || !/^\d{1,39}$/.test(price)) return undefined;

  return {
    chainId: chainId as number,
    contract,
    payee,
    price: BigInt(price),
    minRemainingSeconds: minRemainingSeconds as number,
  };
}
