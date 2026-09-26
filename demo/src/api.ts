import { formatUsdc } from "arc-tabs";
import { type Address, formatUnits, getAddress, hexToBigInt, isAddress, size } from "viem";
import type { Network } from "./env";

const USDC_ERC20 = "0x3600000000000000000000000000000000000000";
const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const GAS_ESTIMATES = {
  nativeTransfer: 21_000n,
  erc20Transfer: 65_000n,
  openTab: 120_000n,
  chargeTab: 60_000n,
} as const;

export type PaidRoute = (net: Network) => Promise<unknown>;

export function matchPaidRoute(pathname: string): PaidRoute | "bad-request" | undefined {
  if (pathname === "/v1/fees") return fees;

  const balanceMatch = pathname.match(/^\/v1\/balance\/([^/]+)$/);
  if (!balanceMatch) return undefined;
  const candidate = balanceMatch[1]!;
  if (!isAddress(candidate, { strict: false })) return "bad-request";
  const address = getAddress(candidate);
  return (net) => balance(net, address);
}

async function fees({ client }: Network) {
  const block = await client.getBlock();
  const nextBaseFee = size(block.extraData) === 8 ? hexToBigInt(block.extraData) : (block.baseFeePerGas ?? 0n);
  const costInUsdc = (gas: bigint) => formatUsdc(gas * nextBaseFee);

  return {
    block: block.number.toString(),
    nextBaseFeeWei: nextBaseFee.toString(),
    usdcPerMillionGas: costInUsdc(1_000_000n),
    estimatedCostsUsdc: Object.fromEntries(
      Object.entries(GAS_ESTIMATES).map(([action, gas]) => [action, costInUsdc(gas)]),
    ),
  };
}

async function balance({ client }: Network, address: Address) {
  const [native, erc20View, nonce, code] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: USDC_ERC20, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] }),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
  ]);

  return {
    address,
    usdc: formatUsdc(native),
    usdcErc20View: formatUnits(erc20View, 6),
    hiddenDust: formatUsdc(native - erc20View * 10n ** 12n),
    nonce,
    isContract: code !== undefined && code !== "0x",
  };
}
