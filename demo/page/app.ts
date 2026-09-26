import { createTabPayer, formatUsdc, type PayerTab, parseOffer, parseUsdc, type TabOffer } from "arc-tabs";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  type EIP1193Provider,
  getAddress,
  type Hex,
  isAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const DEPOSIT = parseUsdc("0.01");
const LIFETIME_SECONDS = 3600;
const STORAGE_KEY = "arc-tabs-demo";

const NETWORKS: Record<number, { name: string; rpc: string; explorer: string }> = {
  5042: { name: "Arc", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" },
  5042002: { name: "Arc Testnet", rpc: "https://rpc.testnet.arc.io", explorer: "https://explorer.testnet.arc.io" },
};

type SavedTab = { tabId: string; total: string; deposit: string; expiresAt: string };
type SavedSession = { sessionKey: Hex; tab?: SavedTab };
type TabPayer = ReturnType<typeof createTabPayer>;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSession(): SavedSession {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SavedSession | null;
    if (saved?.sessionKey) return saved;
  } catch {}
  return { sessionKey: generatePrivateKey() };
}

function saveSession(session: SavedSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

function toSaved(tab: PayerTab): SavedTab {
  return {
    tabId: tab.tabId.toString(),
    total: tab.total.toString(),
    deposit: tab.deposit.toString(),
    expiresAt: tab.expiresAt.toString(),
  };
}

function fromSaved(saved: SavedTab, offer: TabOffer): PayerTab {
  return {
    offer,
    tabId: BigInt(saved.tabId),
    total: BigInt(saved.total),
    deposit: BigInt(saved.deposit),
    expiresAt: BigInt(saved.expiresAt),
  };
}

function setStatus(id: string, text: string, state?: "ok" | "error") {
  const target = element(id);
  target.textContent = text;
  if (state) target.dataset.state = state;
  else delete target.dataset.state;
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function describeExpiry(expiresAt: bigint) {
  const secondsLeft = Number(expiresAt) - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return "expired";
  return `in ${Math.ceil(secondsLeft / 60)} min`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}

async function loadOffer(): Promise<TabOffer> {
  const offer = parseOffer(await (await fetch("/v1/offer")).json());
  if (!offer) throw new Error("The API returned an offer this page cannot read.");
  return offer;
}

async function loadStats() {
  const stats = (await (await fetch("/v1/stats")).json()) as { paidCalls: number; chargedTotal: string; tabs: number };
  element("stats-calls").textContent = stats.paidCalls.toLocaleString("en");
  element("stats-charged").textContent = formatUsdc(BigInt(stats.chargedTotal));
  element("stats-tabs").textContent = stats.tabs.toLocaleString("en");
}

async function switchWalletTo(provider: EIP1193Provider, chainId: number) {
  const hexChainId = `0x${chainId.toString(16)}` as const;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (error) {
    const unknownChain = (error as { code?: number }).code === 4902;
    const known = NETWORKS[chainId];
    if (!unknownChain || !known) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId,
          chainName: known.name,
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: [known.rpc],
          blockExplorerUrls: [known.explorer],
        },
      ],
    });
  }
}

function renderLedger(tab: PayerTab | undefined, offer: TabOffer) {
  element("ledger").hidden = !tab;
  if (!tab) return;
  element("ledger-deposit").textContent = formatUsdc(tab.deposit);
  element("ledger-signed").textContent = formatUsdc(tab.total);
  element("ledger-calls").textContent = (tab.total / offer.price).toString();
  element("ledger-expires").textContent = describeExpiry(tab.expiresAt);
  element("reclaim").hidden = describeExpiry(tab.expiresAt) !== "expired";
}

function setCallsEnabled(enabled: boolean) {
  element<HTMLButtonElement>("call-balance").disabled = !enabled;
  element<HTMLButtonElement>("call-fees").disabled = !enabled;
}

async function main() {
  const offer = await loadOffer();
  const network = NETWORKS[offer.chainId];
  element("network-name").textContent = `${network?.name ?? "Arc"} · USDC`;
  const contractLink = element<HTMLAnchorElement>("contract-link");
  contractLink.textContent = offer.contract;
  if (network) contractLink.href = `${network.explorer}/address/${offer.contract}`;
  loadStats().catch(() => setStatus("stats-calls", "unavailable"));

  const session = loadSession();
  saveSession(session);
  const sessionSigner = privateKeyToAccount(session.sessionKey);
  let payer: TabPayer | undefined;

  const currentTab = () => payer?.tabs()[0];
  const persistTab = () => {
    const tab = currentTab();
    saveSession({ sessionKey: session.sessionKey, tab: tab && toSaved(tab) });
    renderLedger(tab, offer);
  };

  element("connect").addEventListener("click", async () => {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("wallet-status", "No browser wallet found. Install one that can add custom networks.", "error");
      return;
    }
    const button = element<HTMLButtonElement>("connect");
    button.disabled = true;
    try {
      const [account] = await provider.request({ method: "eth_requestAccounts" });
      if (!account) throw new Error("The wallet shared no account.");
      await switchWalletTo(provider, offer.chainId);

      const chain = defineChain({
        id: offer.chainId,
        name: network?.name ?? "Arc",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: { default: { http: [network?.rpc ?? ""] } },
      });
      const client = createPublicClient({ chain, transport: custom(provider) });
      const wallet = createWalletClient({ chain, transport: custom(provider), account: getAddress(account) });
      payer = createTabPayer({
        client,
        wallet,
        signer: sessionSigner,
        maxPrice: offer.price,
        deposit: DEPOSIT,
        lifetimeSeconds: LIFETIME_SECONDS,
        initialTabs: session.tab ? [fromSaved(session.tab, offer)] : [],
      });

      const balance = await client.getBalance({ address: getAddress(account) });
      setStatus("wallet-status", `Connected ${shortAddress(getAddress(account))}. Balance ${Number(formatUsdc(balance)).toFixed(4)} USDC.`, "ok");
      element<HTMLInputElement>("address-input").value ||= getAddress(account);
      button.textContent = "Connected";

      const hasTab = currentTab() !== undefined;
      element<HTMLButtonElement>("open-tab").disabled = hasTab;
      setCallsEnabled(hasTab);
      if (hasTab) setStatus("tab-status", `Tab ${currentTab()!.tabId} is open.`, "ok");
      persistTab();
    } catch (error) {
      button.disabled = false;
      setStatus("wallet-status", errorMessage(error), "error");
    }
  });

  element("open-tab").addEventListener("click", async () => {
    if (!payer) return;
    const button = element<HTMLButtonElement>("open-tab");
    button.disabled = true;
    setStatus("tab-status", "Confirm the deposit in your wallet.");
    try {
      const tab = await payer.prepareTab(offer);
      setStatus("tab-status", `Tab ${tab.tabId} is open with ${formatUsdc(tab.deposit)} USDC.`, "ok");
      setCallsEnabled(true);
      persistTab();
    } catch (error) {
      button.disabled = false;
      setStatus("tab-status", errorMessage(error), "error");
    }
  });

  async function callApi(path: string) {
    if (!payer) return;
    const response = element("response");
    setCallsEnabled(false);
    try {
      const started = performance.now();
      const reply = await payer.fetch(new URL(path, location.origin));
      const elapsed = Math.round(performance.now() - started);
      const body = await reply.json();
      response.textContent = `${reply.status} in ${elapsed} ms\n${JSON.stringify(body, null, 2)}`;
      if (reply.ok) delete response.dataset.state;
      else response.dataset.state = "error";
      persistTab();
      loadStats().catch(() => undefined);
    } catch (error) {
      response.textContent = errorMessage(error);
      response.dataset.state = "error";
    } finally {
      setCallsEnabled(true);
    }
  }

  element("call-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const address = element<HTMLInputElement>("address-input").value.trim();
    if (!isAddress(address, { strict: false })) {
      element("response").textContent = "Enter a 0x address with 40 hex characters.";
      element("response").dataset.state = "error";
      return;
    }
    callApi(`/v1/balance/${address}`);
  });
  element("call-fees").addEventListener("click", () => callApi("/v1/fees"));

  element("reclaim").addEventListener("click", async () => {
    const tab = currentTab();
    if (!payer || !tab) return;
    const button = element<HTMLButtonElement>("reclaim");
    button.disabled = true;
    try {
      await payer.reclaim(tab);
      setStatus("tab-status", "Unused USDC is back in your wallet. Open a new tab to keep going.", "ok");
      element<HTMLButtonElement>("open-tab").disabled = false;
      setCallsEnabled(false);
      persistTab();
    } catch (error) {
      setStatus("tab-status", errorMessage(error), "error");
    } finally {
      button.disabled = false;
    }
  });

  setInterval(() => renderLedger(currentTab(), offer), 30_000);
}

main().catch((error) => setStatus("wallet-status", errorMessage(error), "error"));
