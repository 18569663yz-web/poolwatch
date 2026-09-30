# Unclaimed Uniswap V3 fees

Enter any Ethereum address and see the Uniswap V3 LP fees it never collected.
Read-only: no wallet connection, no signatures, no server, no logging.

**Live: <https://poolwatch.dess.lol>**

## What this repository is

This repository **is** the deployed site. There is no build step, no bundler, no
minifier and no third-party runtime dependency — the files you read here are
byte-for-byte the files your browser downloads. That is deliberate. The whole
proposal of this tool is that you should not have to trust it, and reading the
code is the cheapest way to stop having to.

If the folder listing looks unfamiliar: the site lives under `site/`, and the
tiny root `index.html` is only a redirect stub so that the short URL works.

| file | what it does |
| --- | --- |
| `site/app.js` | the UI, the query state machine, URL-hash handling |
| `site/i18n.js` | every string, English and Chinese |
| `data-adapter.js` | the query entry point: enumerate positions, price them, total them |
| `kernel/index.mjs` | the fee math — `feeGrowthInside`, Q128 arithmetic, `collect()` simulation |
| `kernel/keccak.mjs` | a dependency-free Keccak-256 (needed to derive pool addresses) |
| `kernel/rpc.mjs` | JSON-RPC batching against public Ethereum endpoints |
| `_headers` | the CSP, and why `*.mjs` is explicitly served as JavaScript |

## The numbers it puts on screen

- **$38,384,084** — a hard **lower bound** on uncollected Uniswap V3 fees on
  Ethereum mainnet. It is what you get from pool balances alone (90 major-token
  pools, 2026-09-28), so it is provable rather than estimated. A full pass over
  all 71,818 pools puts the total near $53M.
- **Per address** the tool reports the *math entitlement*: what `collect()`
  would pay if you called it right now. We simulate `collect()` per position and
  compare. In every comparison the pool's own accounting drift made `collect()`
  pay **at most 6 wei less** than the entitlement, and never more. That is why
  the page says "at least" instead of giving one exact figure.

## Limitation, stated plainly

- **Ethereum mainnet only**, and only the canonical Uniswap V3
  `NonfungiblePositionManager`. A V3 fork that deployed its own position manager
  is not covered.
- **Long-tail tokens are not priced.** Roughly the top 3,000 tokens have a price
  feed; a position holding anything else is shown without a USD value and left
  out of the total — which makes every total a lower bound.
- **Public RPC endpoints rate-limit.** A query that fails is a rate limit far
  more often than a bug; retrying works.

## Verifying it yourself

1. Open the site, open **DevTools → Network**, run a query. The only hosts
   contacted are the ones listed in `connect-src` in `_headers`: public Ethereum
   RPC endpoints and one price API. Nothing else, and no request carries your
   address anywhere except to those RPC nodes.
2. The same policy also travels as a
   `<meta http-equiv="Content-Security-Policy">` inside `site/index.html`, so it
   still holds on hosts that cannot send HTTP headers. The two copies are
   asserted to agree before every release.
3. The site never connects to a wallet, never asks for a signature and has no
   server of its own, so it has no way to move funds even if it wanted to.

## How to collect

Each result row links to the position on Uniswap's own interface. Open it there
and press **Collect** with your own wallet. Collecting always goes through
Uniswap's official page and pays 100% to your own wallet — this tool never takes
a cut and never asks you to sign anything.

## Self-hosting

Copy the files to any static host. If the host can send headers, keep
`_headers`. If it cannot (an IPFS gateway, for example), the `<meta>` CSP still
applies and the site still works — but check that the gateway serves `.mjs` as
JavaScript, because ES module loading fails hard on a wrong MIME type.

## License

There is no LICENSE file yet, so the default applies: all rights reserved. If
you want to reuse this code, open an issue and say so.
