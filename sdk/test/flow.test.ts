import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicClient, createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createMemoryVoucherStore,
  createTabCollector,
  createTabGate,
  createTabPayer,
  OfferRefusedError,
  parseUsdc,
  readTab,
  type TabOffer,
  VOUCHER_HEADER,
} from "../src";
import { type LocalChain, localArc, startLocalChain } from "./chain";

const PRICE = parseUsdc("0.001");

let chain: LocalChain;

beforeAll(async () => {
  chain = await startLocalChain();
});

afterAll(() => chain.stop());

function startPaidApi(price = PRICE, failingCalls = 0) {
  const arc = localArc(chain.url);
  const client = createPublicClient({ chain: arc, transport: http() });
  const store = createMemoryVoucherStore();
  const offer: TabOffer = {
    chainId: arc.id,
    contract: chain.contract,
    payee: chain.payee.address,
    price,
    minRemainingSeconds: 600,
  };
  const gate = createTabGate({ client, offer, store });
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return gate.serve(request, async ({ voucher, charged }) => {
        if (failingCalls-- > 0) return Response.json({ reason: "upstream down" }, { status: 502 });
        return Response.json({ charged: charged.toString(), total: voucher.total.toString() });
      });
    },
  });
  const wallet = createWalletClient({ chain: arc, transport: http(), account: chain.payee });
  const collector = createTabCollector({ client, wallet, contract: chain.contract, store });
  return { url: `http://127.0.0.1:${server.port}/report`, client, store, collector, stop: () => server.stop(true) };
}

function createAgent(maxPrice = PRICE) {
  const arc = localArc(chain.url);
  return createTabPayer({
    client: createPublicClient({ chain: arc, transport: http() }),
    wallet: createWalletClient({ chain: arc, transport: http(), account: chain.payer }),
    signer: privateKeyToAccount(generatePrivateKey()),
    maxPrice,
    deposit: parseUsdc("0.01"),
    lifetimeSeconds: 3600,
  });
}

describe("paid API over a tab", () => {
  test("agent pays each call with one deposit and payee collects the sum", async () => {
    const api = startPaidApi();
    const agent = createAgent();

    for (let call = 1; call <= 5; call++) {
      const response = await agent.fetch(api.url);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ charged: PRICE.toString(), total: (PRICE * BigInt(call)).toString() });
    }

    const [tab] = agent.tabs();
    expect(tab?.total).toBe(PRICE * 5n);

    const before = await api.client.getBalance({ address: chain.payee.address });
    await api.collector.collect(tab!.tabId);
    const onchain = await readTab(api.client, chain.contract, tab!.tabId);
    expect(onchain.paid).toBe(PRICE * 5n);
    expect(await api.client.getBalance({ address: chain.payee.address })).toBeGreaterThan(before);
    api.stop();
  });

  test("concurrent calls on one tab all succeed", async () => {
    const api = startPaidApi();
    const agent = createAgent();

    const responses = await Promise.all(Array.from({ length: 6 }, () => agent.fetch(api.url)));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(agent.tabs()[0]?.total).toBe(PRICE * 6n);
    api.stop();
  });

  test("agent tops up when the deposit runs out", async () => {
    const api = startPaidApi(parseUsdc("0.004"));
    const agent = createAgent(parseUsdc("0.004"));

    for (let call = 0; call < 4; call++) expect((await agent.fetch(api.url)).status).toBe(200);

    const [tab] = agent.tabs();
    expect(tab?.deposit).toBe(parseUsdc("0.02"));
    api.stop();
  });

  test("a failed call is not charged", async () => {
    const api = startPaidApi(PRICE, 1);
    const agent = createAgent();

    expect((await agent.fetch(api.url)).status).toBe(502);
    const second = await agent.fetch(api.url);

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ charged: PRICE.toString(), total: PRICE.toString() });
    expect(agent.tabs()[0]?.total).toBe(PRICE);
    api.stop();
  });

  test("agent refuses an offer above its price limit", async () => {
    const api = startPaidApi(parseUsdc("0.5"));
    const agent = createAgent();

    await expect(agent.fetch(api.url)).rejects.toBeInstanceOf(OfferRefusedError);
    api.stop();
  });

  test("gate rejects a replayed voucher", async () => {
    const api = startPaidApi();
    let voucherHeader = "";
    const recordingAgent = createTabPayer({
      ...agentOptions(),
      fetch: async (input, init) => {
        voucherHeader = new Headers(init?.headers).get(VOUCHER_HEADER) ?? voucherHeader;
        return fetch(input, init);
      },
    });

    expect((await recordingAgent.fetch(api.url)).status).toBe(200);
    const replay = await fetch(api.url, { headers: { [VOUCHER_HEADER]: voucherHeader } });

    expect(replay.status).toBe(402);
    expect((await replay.json()).reason).toBe("The voucher adds less than the price.");
    api.stop();
  });

  test("gate rejects a voucher signed by someone else", async () => {
    const api = startPaidApi();
    const recordingAgent = createTabPayer({
      ...agentOptions(),
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        const voucher = headers.get(VOUCHER_HEADER);
        if (voucher) headers.set(VOUCHER_HEADER, voucher.replace(/:0x.*/, `:0x${"11".repeat(65)}`));
        return fetch(input, { ...init, headers });
      },
    });

    const response = await recordingAgent.fetch(api.url);

    expect(response.status).toBe(402);
    api.stop();
  });

  test("payee close pays the latest voucher and refunds the rest", async () => {
    const api = startPaidApi();
    const agent = createAgent();
    await agent.fetch(api.url);
    await agent.fetch(api.url);
    const [tab] = agent.tabs();

    await api.collector.close(tab!.tabId);

    const onchain = await readTab(api.client, chain.contract, tab!.tabId);
    expect(onchain.paid).toBe(PRICE * 2n);
    expect(onchain.deposit).toBe(PRICE * 2n);
    api.stop();
  });
});

function agentOptions() {
  const arc = localArc(chain.url);
  return {
    client: createPublicClient({ chain: arc, transport: http() }),
    wallet: createWalletClient({ chain: arc, transport: http(), account: chain.payer }),
    signer: privateKeyToAccount(generatePrivateKey()),
    maxPrice: PRICE,
    deposit: parseUsdc("0.01"),
    lifetimeSeconds: 3600,
  };
}
