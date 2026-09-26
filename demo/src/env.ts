import { type Address, createPublicClient, defineChain, getAddress, http, type PublicClient } from "viem";
import type { TabLedger } from "./ledger";
import type { StatsCounter } from "./stats";

export type Env = {
  RPC_URL: string;
  CHAIN_ID: string;
  TABS_CONTRACT: string;
  TABS_DEPLOY_BLOCK: string;
  PAYEE: string;
  COLLECT_DELAY_SECONDS: string;
  COLLECTOR_KEY: string;
  TAB_LEDGER: DurableObjectNamespace<TabLedger>;
  STATS: DurableObjectNamespace<StatsCounter>;
};

export type Network = {
  chainId: number;
  contract: Address;
  deployBlock: bigint;
  payee: Address;
  client: PublicClient;
};

export function network(env: Env): Network {
  const chainId = Number(env.CHAIN_ID);
  const chain = defineChain({
    id: chainId,
    name: chainId === 5042 ? "Arc" : "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  });
  return {
    chainId,
    contract: getAddress(env.TABS_CONTRACT),
    deployBlock: BigInt(env.TABS_DEPLOY_BLOCK),
    payee: getAddress(env.PAYEE),
    client: createPublicClient({ chain, transport: http() }) as PublicClient,
  };
}
