import type { Address, Hex, LocalAccount } from "viem";

export type TabsDeployment = {
  chainId: number;
  contract: Address;
};

export type Voucher = {
  tabId: bigint;
  total: bigint;
  signature: Hex;
};

export const VOUCHER_HEADER = "Payment-Tab";

export const voucherTypes = {
  Voucher: [
    { name: "tabId", type: "uint256" },
    { name: "total", type: "uint128" },
  ],
} as const;

export function tabsDomain({ chainId, contract }: TabsDeployment) {
  return { name: "Arc Tabs", version: "1", chainId, verifyingContract: contract } as const;
}

export async function signVoucher(
  signer: LocalAccount,
  deployment: TabsDeployment,
  tabId: bigint,
  total: bigint,
): Promise<Voucher> {
  const signature = await signer.signTypedData({
    domain: tabsDomain(deployment),
    types: voucherTypes,
    primaryType: "Voucher",
    message: { tabId, total },
  });
  return { tabId, total, signature };
}

export function formatVoucher({ tabId, total, signature }: Voucher): string {
  return `${tabId}:${total}:${signature}`;
}

export function parseVoucher(header: string | null): Voucher | undefined {
  const match = header?.match(/^(\d{1,78}):(\d{1,39}):(0x(?:[0-9a-fA-F]{2})+)$/);
  if (!match) return undefined;
  const [, tabId, total, signature] = match as unknown as [string, string, string, Hex];
  return { tabId: BigInt(tabId), total: BigInt(total), signature };
}
