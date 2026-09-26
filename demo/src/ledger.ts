import { DurableObject } from "cloudflare:workers";
import { createTabCollector, type Voucher, type VoucherStore } from "arc-tabs";
import { createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Env, network } from "./env";

type StoredVoucher = { tabId: string; total: string; signature: Hex };

export class TabLedger extends DurableObject<Env> {
  async latest(): Promise<StoredVoucher | undefined> {
    return this.ctx.storage.get<StoredVoucher>("voucher");
  }

  async replace(expectedTotal: string | undefined, next: StoredVoucher): Promise<boolean> {
    const current = await this.latest();
    if (current?.total !== expectedTotal) return false;

    await this.ctx.storage.put("voucher", next);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + Number(this.env.COLLECT_DELAY_SECONDS) * 1000);
    return true;
  }

  private asVoucherStore(): VoucherStore {
    return {
      latest: async () => {
        const stored = await this.latest();
        return stored && fromStored(stored);
      },
      replace: (expected, next) => this.replace(expected?.total.toString(), toStored(next)),
    };
  }

  override async alarm(): Promise<void> {
    const stored = await this.latest();
    if (!stored) return;

    const { client, contract, chainId } = network(this.env);
    const wallet = createWalletClient({
      chain: client.chain!,
      transport: http(),
      account: privateKeyToAccount(this.env.COLLECTOR_KEY as Hex),
    });
    await createTabCollector({ client, wallet, contract, store: this.asVoucherStore() }).collect(BigInt(stored.tabId));
    console.log(`collected tab ${stored.tabId} up to ${stored.total} on chain ${chainId}`);
  }
}

export function durableVoucherStore(namespace: DurableObjectNamespace<TabLedger>): VoucherStore {
  const ledger = (tabId: bigint) => namespace.get(namespace.idFromName(tabId.toString()));
  return {
    async latest(tabId) {
      const stored = await ledger(tabId).latest();
      return stored && fromStored(stored);
    },
    async replace(expected, next) {
      return ledger(next.tabId).replace(expected?.total.toString(), toStored(next));
    },
  };
}

function toStored(voucher: Voucher): StoredVoucher {
  return { tabId: voucher.tabId.toString(), total: voucher.total.toString(), signature: voucher.signature };
}

function fromStored(stored: StoredVoucher): Voucher {
  return { tabId: BigInt(stored.tabId), total: BigInt(stored.total), signature: stored.signature };
}
