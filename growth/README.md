# Growth Terminal

A private, market-style dashboard and bounded optimization agent for Dos Búhos advertising, bookings and capacity. Runs on Cloudflare Workers behind the Hub (`/growth/`). Worker `growth` (local demo: `growth-dev`), D1, R2, one Durable Object per ad account, two Workflows, one 15-minute cron.

**Real data:** Google Ads for the Dos Búhos account, read every hour from the Hub's existing feed (read-only). Bookings are not connected yet (OpenTable reservation data is partner-only). `npm run dev` gives a full local demo on synthetic data.

| | Status (2026-11-14) |
|---|---|
| Real | Google Ads spend/clicks/conversions via the Hub (D1 `growth` and R2 `growth-archive` created; schema applied). Domain, policy and coordinator logic; dashboard; watchdog; reports |
| Mocked | The ad account in dev/demo (`MockAdsProvider`); every demo number (`fixtures/demo-data.ts`) |
| Blocked | Google Ads API reads and writes (needs approved API access + owner OAuth); offline conversions; Claude review against the live API (no key here) |
| Tested | 65 tests mapped to the spec's acceptance criteria: `docs/acceptance.md` |
| Deployable | Yes, via Workers Builds once the `growth` Worker is created in the dashboard and `HUB_SECRET` is set (`docs/setup.md`). Ad changes stay impossible until the API adapter exists and the owner goes live |

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

## Estimates (owner-editable, Controles)
- `GET /api/estimates`: value per reservation (restaurant, tours), variable costs, contribution per reservation, history.
- `POST /api/estimates` (admin): new value per reservation. `POST /api/costs` (admin): new cost (`restaurant_cost_pct`,
  `tour_cost_pct`, `payment_fee_pct` in percent; `opentable_fee_per_reservation` in pesos). New rows keep the old ones as history.
- Used only for numbers labeled "estimado": estimated revenue, estimated return and estimated contribution (Resumen, Campañas).
- `GET /api/ai-visibility`, `POST /api/control/ai-visibility-run` (admin, once a day): monthly AI assistant visibility check.
