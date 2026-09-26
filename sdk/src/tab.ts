import type { Address, PublicClient } from "viem";
import { tabsAbi } from "./generated";

export type OnchainTab = {
  payer: Address;
  signer: Address;
  payee: Address;
  expiresAt: bigint;
  deposit: bigint;
  paid: bigint;
};

export async function readTab(client: PublicClient, contract: Address, tabId: bigint): Promise<OnchainTab> {
  const [payer, signer, payee, expiresAt, deposit, paid] = await client.readContract({
    address: contract,
    abi: tabsAbi,
    functionName: "tabs",
    args: [tabId],
  });
  return { payer, signer, payee, expiresAt, deposit, paid };
}

export function unixNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
