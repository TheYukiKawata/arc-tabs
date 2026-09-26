import { formatUnits, parseUnits } from "viem";

const NATIVE_USDC_DECIMALS = 18;

export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, NATIVE_USDC_DECIMALS);
}

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, NATIVE_USDC_DECIMALS);
}
