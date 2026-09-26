import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export type ServiceStats = {
  paidCalls: number;
  chargedTotal: string;
  tabs: number;
};

export class StatsCounter extends DurableObject<Env> {
  async read(): Promise<ServiceStats> {
    return {
      paidCalls: (await this.ctx.storage.get<number>("paidCalls")) ?? 0,
      chargedTotal: (await this.ctx.storage.get<string>("chargedTotal")) ?? "0",
      tabs: (await this.ctx.storage.get<number>("tabs")) ?? 0,
    };
  }

  async record(tabId: string, charged: string): Promise<void> {
    const stats = await this.read();
    const knownTab = (await this.ctx.storage.get<boolean>(`tab:${tabId}`)) ?? false;
    await this.ctx.storage.put({
      paidCalls: stats.paidCalls + 1,
      chargedTotal: (BigInt(stats.chargedTotal) + BigInt(charged)).toString(),
      tabs: knownTab ? stats.tabs : stats.tabs + 1,
      [`tab:${tabId}`]: true,
    });
  }
}

export function statsCounter(namespace: DurableObjectNamespace<StatsCounter>) {
  return namespace.get(namespace.idFromName("service"));
}
