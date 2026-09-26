import type { Account, Address, Chain, Hash, PublicClient, Transport, WalletClient } from "viem";
import { tabsAbi } from "./generated";
import type { VoucherStore } from "./store";
import { readTab } from "./tab";

export type TabCollectorOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  contract: Address;
  store: VoucherStore;
};

export function createTabCollector({ client, wallet, contract, store }: TabCollectorOptions) {
  async function unpaidVoucher(tabId: bigint) {
    const [latest, tab] = await Promise.all([store.latest(tabId), readTab(client, contract, tabId)]);
    return latest && latest.total > tab.paid ? latest : undefined;
  }

  async function collect(tabId: bigint): Promise<Hash | undefined> {
    const voucher = await unpaidVoucher(tabId);
    if (!voucher) return undefined;

    const hash = await wallet.writeContract({
      address: contract,
      abi: tabsAbi,
      functionName: "charge",
      args: [tabId, voucher.total, voucher.signature],
    });
    await client.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function close(tabId: bigint): Promise<Hash> {
    const voucher = await unpaidVoucher(tabId);
    const hash = await wallet.writeContract({
      address: contract,
      abi: tabsAbi,
      functionName: "close",
      args: [tabId, voucher?.total ?? 0n, voucher?.signature ?? "0x"],
    });
    await client.waitForTransactionReceipt({ hash });
    return hash;
  }

  return { collect, close };
}
