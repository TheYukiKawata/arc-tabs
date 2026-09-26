import type { Voucher } from "./voucher";

export interface VoucherStore {
  latest(tabId: bigint): Promise<Voucher | undefined>;
  replace(expected: Voucher | undefined, next: Voucher): Promise<boolean>;
}

export function createMemoryVoucherStore(): VoucherStore {
  const vouchers = new Map<bigint, Voucher>();
  return {
    async latest(tabId) {
      return vouchers.get(tabId);
    },
    async replace(expected, next) {
      if (vouchers.get(next.tabId) !== expected) return false;
      vouchers.set(next.tabId, next);
      return true;
    },
  };
}
