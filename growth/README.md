# Growth Terminal

A private, market-style dashboard and bounded optimization agent for Dos Búhos advertising, bookings and capacity. Runs on Cloudflare Workers behind the Hub (`/growth/`). Worker `growth` (`growth-demo`, `growth-staging`), D1, R2, one Durable Object per ad account, two Workflows, one 15-minute cron.

**It is not connected to any real account yet.** `npm run dev` gives a full demo on synthetic data with a simulated ad account.

| | Status (2026-11-14) |
|---|---|
| Real | Domain, policy and coordinator logic; dashboard; Google Ads Script feed; OpenTable CSV import; manual capacity; watchdog; reports. Exercised locally end to end |
| Mocked | The ad account in dev/demo (`MockAdsProvider`); every demo number (`fixtures/demo-data.ts`) |
| Blocked | Google Ads API reads and writes (needs approved API access + owner OAuth); offline conversions; Claude review against the live API (no key here) |
| Tested | 63 tests mapped to the spec's acceptance criteria: `docs/acceptance.md` |
| Deployable | Demo environment, once the owner creates the D1/R2 resources (`docs/setup.md`). Production writes stay impossible until the API adapter exists and the owner goes live |

## Layout

```
src/domain        money, time zones, scheduler keys, metrics, measurement, capacity, shared Zod schemas
src/policy        proposal validation, deterministic policy, spend exposure
src/coordinator   action state machine, ledger/outbox core, Durable Object
src/connectors    Google Ads Script feed, OpenTable CSV, Google Ads API (contract), mock provider, crypto
src/read          facts for dashboard/reports, evidence snapshots
src/ai            Claude adapter (bounded tools, number-checked narrative)
src/workflows     cron dispatch, watchdog, review Workflows, reports
src/api           Hono routes, Hub identity check
web/              React dashboard (Vite)
migrations/       D1 schema
fixtures/         synthetic demo data (demo database only)
scripts/          google-ads-feed.js (runs inside Google Ads)
docs/             architecture + ADRs, setup, integrations, measurement & controls, readiness, acceptance, runbooks, costs
```

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run check
```

`npm run dev` builds the dashboard, prepares the local demo database and serves http://127.0.0.1:8787. `npm run check` runs the typecheck, tests and build.

Start with `docs/readiness.md`: what is built, what is connected, and the owner questions.
