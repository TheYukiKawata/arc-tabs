import {
  type Account,
  type Chain,
  type Hash,
  type LocalAccount,
  type PublicClient,
  parseEventLogs,
  type Transport,
  type WalletClient,
} from "viem";
import { tabsAbi } from "./generated";
import { parseOffer, type TabOffer } from "./offer";
import { unixNow } from "./tab";
import { formatVoucher, signVoucher, VOUCHER_HEADER } from "./voucher";

export type TabPayerOptions = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  signer: LocalAccount;
  maxPrice: bigint;
  deposit: bigint;
  lifetimeSeconds: number;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
};

export type PayerTab = {
  offer: TabOffer;
  tabId: bigint;
  total: bigint;
  deposit: bigint;
  expiresAt: bigint;
};

const EXPIRY_MARGIN_SECONDS = 60n;

export class OfferRefusedError extends Error {}

export function createTabPayer(options: TabPayerOptions) {
  const { client, wallet, signer, maxPrice, deposit, lifetimeSeconds } = options;
  const send = options.fetch ?? fetch;
  const offersByOrigin = new Map<string, TabOffer>();
  const tabsByPayee = new Map<string, PayerTab>();
  const queues = new Map<string, Promise<unknown>>();

  function assertAcceptable(offer: TabOffer) {
    if (offer.chainId !== client.chain?.id) throw new OfferRefusedError(`Offer is for chain ${offer.chainId}.`);
    if (offer.price > maxPrice) throw new OfferRefusedError(`Offer price ${offer.price} is above ${maxPrice}.`);
  }

  function serialized<T>(offer: TabOffer, task: () => Promise<T>): Promise<T> {
    const key = tabKey(offer);
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  }

  async function openTab(offer: TabOffer): Promise<PayerTab> {
    const expiresAt = unixNow() + BigInt(lifetimeSeconds);
    const hash = await wallet.writeContract({
      address: offer.contract,
      abi: tabsAbi,
      functionName: "open",
      args: [offer.payee, signer.address, expiresAt],
      value: deposit,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const [opened] = parseEventLogs({ abi: tabsAbi, eventName: "Opened", logs: receipt.logs });
    if (!opened) throw new Error(`Transaction ${hash} opened no tab.`);

    const tab: PayerTab = { offer, tabId: opened.args.tabId, total: 0n, deposit, expiresAt };
    tabsByPayee.set(tabKey(offer), tab);
    return tab;
  }

  async function topUp(tab: PayerTab): Promise<void> {
    const expiresAt = unixNow() + BigInt(lifetimeSeconds);
    const hash = await wallet.writeContract({
      address: tab.offer.contract,
      abi: tabsAbi,
      functionName: "topUp",
      args: [tab.tabId, expiresAt],
      value: deposit,
    });
    await client.waitForTransactionReceipt({ hash });
    tab.deposit += deposit;
    tab.expiresAt = expiresAt;
  }

  function needsTopUp(tab: PayerTab, offer: TabOffer): boolean {
    const runsOutOfFunds = tab.total + offer.price > tab.deposit;
    const expiresSoon = tab.expiresAt < unixNow() + BigInt(offer.minRemainingSeconds) + EXPIRY_MARGIN_SECONDS;
    return runsOutOfFunds || expiresSoon;
  }

  async function readyTab(offer: TabOffer): Promise<PayerTab> {
    const tab = tabsByPayee.get(tabKey(offer)) ?? (await openTab(offer));
    if (needsTopUp(tab, offer)) await topUp(tab);
    return tab;
  }

  async function sendWithVoucher(input: string | URL, init: RequestInit | undefined, offer: TabOffer) {
    const tab = await readyTab(offer);
    const total = tab.total + offer.price;
    const voucher = await signVoucher(signer, offer, tab.tabId, total);
    const headers = new Headers(init?.headers);
    headers.set(VOUCHER_HEADER, formatVoucher(voucher));

    const response = await send(input, { ...init, headers });
    const voucherAccepted = response.status !== 402 && response.status !== 409;
    if (voucherAccepted) tab.total = total;
    return response;
  }

  async function paidFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const origin = new URL(input).origin;
    const knownOffer = offersByOrigin.get(origin);
    const first = knownOffer
      ? await serialized(knownOffer, () => sendWithVoucher(input, init, knownOffer))
      : await send(input, init);
    if (first.status !== 402) return first;

    const offer = parseOffer(await first.clone().json().catch(() => undefined));
    if (!offer) return first;
    assertAcceptable(offer);
    offersByOrigin.set(origin, offer);
    return serialized(offer, () => sendWithVoucher(input, init, offer));
  }

  async function reclaim(tab: PayerTab): Promise<Hash> {
    const hash = await wallet.writeContract({
      address: tab.offer.contract,
      abi: tabsAbi,
      functionName: "reclaim",
      args: [tab.tabId],
    });
    await client.waitForTransactionReceipt({ hash });
    tabsByPayee.delete(tabKey(tab.offer));
    return hash;
  }

  return { fetch: paidFetch, tabs: () => [...tabsByPayee.values()], reclaim };
}

function tabKey(offer: TabOffer): string {
  return `${offer.chainId}:${offer.contract}:${offer.payee}`.toLowerCase();
}
