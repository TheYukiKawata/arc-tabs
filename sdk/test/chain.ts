import type { Subprocess } from "bun";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { type HDAccount, mnemonicToAccount } from "viem/accounts";
import { tabsAbi, tabsBytecode } from "../src/generated";

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

export type LocalChain = {
  url: string;
  contract: Address;
  payer: HDAccount;
  payee: HDAccount;
  stop: () => void;
};

export async function startLocalChain(): Promise<LocalChain> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const anvil: Subprocess = Bun.spawn(["anvil", "--port", String(port), "--chain-id", "5042002", "--silent"]);
  const url = `http://127.0.0.1:${port}`;
  await waitForRpc(url);

  const [deployer, payer, payee] = [0, 2, 3].map((addressIndex) =>
    mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex }),
  ) as [HDAccount, HDAccount, HDAccount];
  const chain = localArc(url);
  const client = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ chain, transport: http(), account: deployer });
  const hash = await wallet.deployContract({ abi: tabsAbi, bytecode: tabsBytecode });
  const { contractAddress } = await client.waitForTransactionReceipt({ hash });
  if (!contractAddress) throw new Error("Tabs deployment returned no address.");

  return { url, contract: contractAddress, payer, payee, stop: () => anvil.kill() };
}

export function localArc(url: string) {
  return defineChain({
    id: 5042002,
    name: "Local Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
}

async function waitForRpc(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await Bun.sleep(50);
  }
  throw new Error(`anvil did not start at ${url}`);
}
