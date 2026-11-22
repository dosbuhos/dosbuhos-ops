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

## Screens: six places (since 2026-11-22)
The same on a desktop (tabs under the top strip) and on a phone (bar at the bottom). Addresses from before (`#overview`, `#activity`, `#connections`…) still resolve.

| Place | What it answers | Screens |
|---|---|---|
| **Hoy** `#hoy` | What needs a decision, where the month lands, which campaign works | one |
| **Campañas** `#campanas` | Spend, reservations, cost and return per campaign; brand vs other searches | one |
| **Sugerencias** `#sugerencias` | What was proposed, what was decided, what happened after (was "Actividad del agente") | one |
| **Reservaciones** `#reservaciones` | Where online reservations come from; the next days | De dónde vienen · Próximos días |
| **Reportes** `#reportes` | Trends, the written reports, experiments, AI assistant visibility | Tendencias · Reportes · Experimentos |
| **Ajustes** (the gear) `#ajustes` | Emergency controls, policy, estimates, connections | Controles · Conexiones |

- `GET /api/today` (read-only): month to date by platform, the projection at the last seven complete days, the policy ceiling,
  yesterday (spend, online reservations, guests, POS sales), pending approvals, this morning's review text, and one verdict per
  campaign. Code: `src/read/today.ts`, tests in `test/today.test.ts`.
- **Verdict rule** (`verdictFor`): return = contribution of the campaign's online reservations ÷ its spend on tracked days.
  *Rinde*: at or above the policy floor (1.5 if unset) with at least 5 reservations. *Vigilar*: covers its cost but is under the
  floor, or has fewer than 5 reservations, or has spent less than twice one reservation's contribution with none yet.
  *Pierde dinero*: under 1×, or twice a reservation's contribution spent with none. *Sin datos*: reservations cannot be seen.
- Roadmap (design and functionality): project doc `claude/growth-terminal-roadmap.md`.
- To go back to the eight-tab layout: revert the commit titled "growth: six places…" (the one before it is `adaf297`), or use
  Cloudflare → Workers → growth → Deployments → Rollback. No migration and no change to how ad changes are applied.

## Estimates (owner-editable, Controles)
- `GET /api/estimates`: value per reservation (restaurant, tours), variable costs, contribution per reservation, history.
- `POST /api/estimates` (admin): new value per reservation. `POST /api/costs` (admin): new cost (`restaurant_cost_pct`,
  `tour_cost_pct`, `payment_fee_pct` in percent; `opentable_fee_per_reservation` in pesos). New rows keep the old ones as history.
- Used only for numbers labeled "estimado": estimated revenue, estimated return and estimated contribution (Resumen, Campañas).
- `GET /api/ai-visibility`, `POST /api/control/ai-visibility-run` (admin, once a day): monthly AI assistant visibility check.

## Weekly summary email
Monday 09:00 (San Miguel) a Spanish email with last week's online reservations, spend, cost per reservation, estimated
contribution, brand-search share and what needs attention. Sent through Resend (`RESEND_API_KEY`, `REPORT_EMAIL_TO`
secrets). Preview: `GET /api/weekly-email-preview`; test send: `POST /api/control/weekly-email-test` (admin).

## Parrot POS
`PARROT_API_KEY` secret (Bearer). Every 15 minutes `pos_sync` re-reads the last 48 h of orders, order items (v2) and
payments from `https://api.parrot.rest/external`, then backfills older 48-hour windows (to 2025-11-01) within a small
request budget (Parrot allows 15 requests/minute). Guests = `customersCount` of dine-in orders, trusted from 2026-11-04.
Shown on Resumen: Comensales (restaurante), Personas en tours, Ventas sin IVA, and guests by weekday.

## Sales history from the previous point of sale (Wansoft)

Parrot's first order is from 11 August 2026, so on its own every "against last year" comparison would be empty and every
"against the previous period" comparison would mostly show the season. The daily sales of the point of sale used before
(Wansoft, 1 September 2022 to 9 August 2026) are loaded once into `pos_daily_history` (migration 0011).

- **Loading it:** Ajustes → Conexiones → "Historial de ventas del punto de venta anterior", admin only. The file is a CSV
  with one line per business day and this header: `fecha,ordenes,comensales,venta_sin_iva,venta_con_iva,restaurante_sin_iva,propinas,descuentos`
  (pesos with decimals). It is prepared from Wansoft's "Reporte de ventas por día". Loading it again replaces the same
  days; days on or after Parrot's first day are skipped. Routes: `GET /api/pos-history`, `POST /api/control/pos-history`.
- **The numbers stay out of this repository.** The table is created by the migration; the rows go straight into D1.
- **How it is used (`src/read/sales.ts`):** one series per business day, Wansoft before Parrot's first day and Parrot from
  then on. A period is compared with the same days 52 weeks earlier (364 days, so weekdays line up), and only when both
  periods are fully on record. Parrot's "Eventos" category is left out of that comparison, because private events were
  never rung up in Wansoft. Shown on Hoy ("Últimos 28 días") and on the sales card in Reportes → Tendencias.
- **Open question:** whether experiences prepaid online were rung up in Wansoft the way they are in Parrot. If they were
  not, the comparison overstates growth in tours and tastings.

## Suggestions from fixed rules (pass 2a)

`src/read/detectors.ts` looks at the search terms of the last 28 complete days (`ga4_ads_queries`) and writes a pitch
for each known situation: what to do, why (only numbers from the evidence), what to expect and how we will know.

- **Rules today:** a search for another wine region (Querétaro, Valle de Guadalupe...) or for another winery by name,
  with clicks and no online reservation, becomes a suggested exact negative keyword. A relevant search with many clicks
  where under 5% open the reservation widget is reported as a landing-page problem, never as a negative. Our own name
  and any search that reserved are left alone. Thresholds and word lists are constants at the top of the file.
- **Path:** the daily review (`reviewAndPropose`) runs the rules before the model, with or without an API key. A
  proposal from a rule goes through `submitProposal` like one from the model: validation, policy, owner approval.
  Nothing a rule finds is ever applied without approval. The same term is not proposed again for 30 days.
- **Why negatives are advice for now:** the validator only accepts a negative keyword when the snapshot holds the
  campaign's active keywords (so it cannot block one by mistake), and the Google Ads Script feed does not send them
  yet. Until it does, the finding is shown on Hoy and Sugerencias with the manual steps. Next step: the feed sends
  enabled keywords per campaign, they are stored, and the snapshot fills `keywords`. Note for that step: the validator
  strips accents from the negative text; check that the keyword sent to Google keeps the accent.
- **"Ahora no":** `POST /api/proposals/:id/decline` with a reason moves a waiting proposal to REJECTED in the
  coordinator and records who and why. Sugerencias shows the reasons as buttons.
- Spend-increasing suggestions (add money) are still refused by policy until measurement is mature, capacity is known
  and the mature return is above the floor. That is unchanged.
