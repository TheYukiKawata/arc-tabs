# Arc Tabs

Pay-per-call APIs in USDC on [Arc](https://arc.io), without one transaction per call.

A client opens a tab: it deposits USDC into the Tabs contract for one API provider, with an expiry. Each paid call carries an EIP-712 voucher that says "this tab owes you N in total". The server checks the signature and the tab balance, runs the call, and keeps the newest voucher. It settles on-chain whenever it wants with `charge()`, one transaction for any number of calls. After expiry, the payer takes back whatever was not charged.

- The payee can never take more than the payer signed for, and never more than the deposit.
- A failed call (non-2xx) is not charged: the server commits the voucher only after the handler succeeds.
- `charge()` is permissionless and always pays the payee, so anyone can settle a voucher.
- Signers can be smart accounts (ERC-1271).

## Live on Arc mainnet

| | |
|---|---|
| Live demo | https://arc-tabs.yukikawata.workers.dev |
| Tabs contract | [`0xD7457dDE7568D5ddE8E189047fB0386Ca7c5744F`](https://explorer.arc.io/address/0xD7457dDE7568D5ddE8E189047fB0386Ca7c5744F) |
| Deploy tx | [`0xdc07ee52…d369608`](https://explorer.arc.io/tx/0xdc07ee52675ed64975b27bf1b6f10f642db4f2be1027b5a8296e64139d369608) (block 22893855) |
| Demo settlement | [`0x53c6b38e…cd7bd5a5a`](https://explorer.arc.io/tx/0x53c6b38e479120627cb4dfea3f92e1ec8508ad3d8034295c6731648cd7bd5a5a): 5 paid calls, about 270 ms each, settled in one `charge()` |

Chain id 5042, RPC `https://rpc.mainnet.arc.io`. The contract is deployed with CREATE2 through `0x4e59b448…4956C`.

## How a call works

1. The client calls a paid route without a voucher and gets `402` with the offer: chain, contract, payee, price, minimum time left on the tab.
2. The client opens a tab on-chain (`open(payee, signer, expiresAt)` with a USDC deposit) or reuses one.
3. Each call sends `Payment-Tab: <tabId>:<total>:<signature>`, where `total` is the previous total plus the price.
4. The server answers with `Payment-Tab-Total` and `Payment-Tab-Charged`. The client advances its total only when that header matches.

## Repository

- `contracts/`: `Tabs.sol` and Foundry tests.
- `sdk/`: TypeScript client and server helpers on viem.
  - `createTabGate` wraps a paid handler on the server.
  - `createTabCollector` settles vouchers.
  - `createTabPayer` gives a client a `fetch` that opens, tops up and signs on its own.
- `demo/`: a Cloudflare Worker that sells Arc fee and balance lookups for 0.0001 USDC per call, with a "Try it" page.

## Use the SDK

Server:

```ts
import { createMemoryVoucherStore, createTabGate, parseUsdc } from "arc-tabs";

const gate = createTabGate({
  client,
  store: createMemoryVoucherStore(),
  offer: { chainId: 5042, contract: TABS, payee: PAYEE, price: parseUsdc("0.0001"), minRemainingSeconds: 600 },
});

return gate.serve(request, async () => Response.json(await lookup()));
```

Client:

```ts
import { createTabPayer, parseUsdc } from "arc-tabs";

const payer = createTabPayer({
  client,
  wallet,
  signer: account,
  maxPrice: parseUsdc("0.001"),
  deposit: parseUsdc("0.01"),
  lifetimeSeconds: 3600,
});

const response = await payer.fetch("https://example.com/v1/fees");
```

## Build and test

Needs [Foundry](https://getfoundry.sh) and [Bun](https://bun.sh).

```sh
git clone --recursive https://github.com/TheYukiKawata/arc-tabs
cd arc-tabs/contracts && forge test
cd ../sdk && bun install && bun run gen:abi && bun run typecheck && bun test
cd ../demo && bun install && bun run build:page && bun run dev
```

The SDK tests start a local anvil chain. To deploy the contract, set `DEPLOYER_MNEMONIC` to the mnemonic of a funded wallet (it uses the first account) and run `bun sdk/scripts/deploy.ts mainnet --send`.

Written by Yuki Kawata with Claude Code.

## License

MIT
