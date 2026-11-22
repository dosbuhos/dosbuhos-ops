# Growth Terminal

A private, market-style dashboard and bounded optimization agent for Dos Búhos advertising, bookings and capacity. Runs on Cloudflare Workers behind the Hub (`/growth/`). Worker `growth` (local demo: `growth-dev`), D1, R2, one Durable Object per ad account, two Workflows, one 15-minute cron.

**Real data:** Google Ads for the Dos Búhos account, read every hour from the Hub's existing feed (read-only). Bookings are not connected yet (OpenTable reservation data is partner-only). `npm run dev` gives a full local demo on synthetic data.

| | Status (2026-11-14) |
|---|---|
| Real | Google Ads spend/clicks/conversions via the Hub (D1 `growth` and R2 `growth-archive` created; schema applied). Domain, policy and coordinator logic; dashboard; watchdog; reports |
| Mocked | The ad account in dev/demo (`MockAdsProvider`); every demo number (`fixtures/demo-data.ts`) |
| Blocked | Google Ads API reads and writes (needs approved API access + owner OAuth); offline conversions; Claude review against the live API (no key here) |
| Tested | 184 tests (2026-11-22); the first 65 map to the spec's acceptance criteria: `docs/acceptance.md` |
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
| **Reservaciones** `#reservaciones` | Where online reservations come from; what was paid online by card; the next days | De dónde vienen · Pagos · Próximos días |
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

## Card payments (Stripe, through the wine club Worker)
No Stripe key here. The service binding `STRIPE` reaches the `StripeRead` entrypoint of the `wineclub` Worker
(`wineclub/src/payments.js`), which holds the key and removes every personal field before answering: a charge arrives
as amounts, dates, where it came from (`opentable`, `rezdy`, `wine_club`, `web_store`, `invoice`, `payment_link`,
`other`), the OpenTable experience id, platform and reservation time, the Rezdy order code or Zoho invoice number, and
the card's country. Every OpenTable prepayment
is a charge in that same Stripe account, so this is also the source for prepaid experiences.

- `payments_sync` (every 15 minutes, `src/connectors/stripe-payments.ts`): the charges of the last three days, the
  charges refunded since the last run (a guest can cancel weeks after paying), then older pages of history, newest
  first, within 14 calls a run, until Stripe has no more. It resumes from `stripe_sync_state`. Failed attempts are not
  kept. Connection `conn_stripe`.
- `GET /api/payments` (`src/read/payments.ts`) feeds **Reservaciones → Pagos**: experiences paid online in the last
  28 complete days against the 28 before and the same weeks a year earlier (those were Rezdy), what is already
  charged for visits from today on, by experience, by where the guest booked, by card country, and thirteen months
  by source. Net of refunds, IVA included, pesos only. `GET /api/today` carries one line of it (`prepaid`).
- It is never added to the point-of-sale sales: part of the prepaid visits is also rung up in Parrot on the day, as
  a transfer, and would count twice. Nothing here is attributed to a campaign.
- Experience names come from `EXPERIENCES` in `src/connectors/opentable-availability.ts`.

## OpenTable availability when OpenTable refuses
Since 2026-11-14 OpenTable answers 403 to the public availability queries from this Worker. A refusal is stored as
`limited` with the reason in plain words (the owner cannot fix it, so it is not a warning on Hoy), and the read is
tried once a day instead of every three hours (`availabilityOnHold`). A changed page (new query hashes) still shows
as `reconnect`.

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

## Suggestions from fixed rules (passes 2a and 2b)

`src/read/detectors.ts` reads the search terms of the last 28 complete days (`ga4_ads_queries`) and writes a pitch for
each known situation: what to do, why (only numbers from the evidence), what to expect and how we will know.

- **The unit is a theme, not a search.** A theme is one word that marks another wine region (Querétaro, Valle de
  Guadalupe...) or another winery (Trinidad, Raíces, San Lucas...). Every search that carries the word is added up, so
  twenty small searches that each look harmless show as one line with its total. The word list and the thresholds are
  constants at the top of the file.
- **What the rules report:** a theme with clicks and no online reservation (`theme_place`, `theme_competitor`); a
  campaign that only reserves on searches for our name (`brand_split`, advice only); a relevant search with many clicks
  where almost nobody opens the reservation widget (`landing_gap`, advice only, never a negative). Our name, our town
  and any search that reserved are left alone. A theme that is already blocked, or that stopped coming in, drops off.
- **One decision per theme:** the action class `block_search_theme {text}` (`src/policy/validate.ts`). The server, not
  the model, builds the operations from one word: pause the campaign's active keywords that contain it
  (`pause_keyword`) and add it as a phrase negative in the forms people typed, accents kept (`add_negative_phrase`).
  It refuses a word under 4 letters, our name or town, a theme with a reservation, more than 25% of the campaign's
  clicks, more than 20 keywords, or a keyword with Google conversions. The owner sees the exact operations and what
  they would have stopped in 28 days before approving. Always waits for approval.
- **Why the feed matters:** the app can only tell a stray search (block it) from a keyword somebody put in the campaign
  (pause it) when the Google Ads Script sends the keywords. Until the newer script is pasted, a theme is shown as a
  finding with a note, never as a manual to-do. `feed_state` records the script's version, when each section last
  arrived and anything it could not read; Ajustes → Conexiones shows it.
- **Path:** the daily review (`reviewAndPropose`) runs the rules before the model, with or without an API key
  (`src/read/suggestions.ts`). A proposal from a rule goes through `submitProposal` like one from the model:
  validation, policy, owner approval. At most 3 per run. A finding is not sent again while it waits, for 30 days after
  it was applied or declined, or for 7 days after the server refused to build it; one that expired unseen comes back.
- **The model's part:** it reads `get_current_month` first (this month against the ceiling, the last 28 days per
  campaign with its verdict, the rules' findings and what became of each) and writes a short summary for the owner. It
  does not resubmit what the rules sent. The rules' line and the model's summary are kept in full in `review_notes`.
- **After a change:** `loadResults` compares equal whole days before and after (stages `en_cola`, `midiendo`, 7 and 14
  days) and says whether the theme stopped coming in. Shown on Hoy ("Lo que pasó después") and in Sugerencias.
- **"Ahora no":** `POST /api/proposals/:id/decline` with a reason moves a waiting proposal to REJECTED in the
  coordinator and records who and why. Sugerencias shows the reasons as buttons.
- **Daily limit:** `maxOptimizationMutationsPerDay` counts approved changes in 24 hours. When it is used up, approving
  is refused and the suggestion keeps waiting, instead of being approved into a refusal.
- Spend-increasing suggestions (add money) are still refused by policy until measurement is mature, capacity is known
  and the mature return is above the floor. That is unchanged.

## Google Ads Script (version 2026-11-22.2)

`scripts/google-ads-feed.js` runs every hour inside Google Ads. It applies the changes approved in the app, then reads
the account and posts it to `/api/feed/google-ads`.

- **Sends:** campaigns, 90 days of daily numbers, today's spend, search terms, budget changes, ads, and since version 2
  the keywords of enabled campaigns with their 28-day numbers, the keyword behind each search, and negative keywords of
  every match type and level (campaign, ad group, shared list, account list). Each newer section has its own try/catch:
  if Google refuses one query the spend numbers still go out and the app shows what could not be read.
- **Applies:** `set_budget`, `pause_campaign`, `pause_ad`, `add_negative_exact`, `add_negative_phrase`,
  `pause_keyword`, and the two undo operations `enable_keyword` and `remove_negative` (the app does not queue those
  yet: undoing a block is done by hand in Google Ads). Each is applied only if the account still shows what the
  approval was based on; otherwise it is skipped and reported.
- **Installing a new version:** Ajustes → Conexiones → "Copiar el script nuevo" creates a feed token, fills it into the
  script and copies it. A new token takes over the first time it is used and only then revokes the older ones, so the
  copy that is running keeps working until the new one reports. `SCRIPT_VERSION` must match the constant of the same
  name in `src/connectors/google-ads-feed.ts` (a test checks it).
- **Queued changes:** a provider that queues (`deferred`) gets every independent operation of a change at once; the
  change is verified against a later report of the account, not the one from the same run. A change in the queue is an
  information notice for two hours and a warning after that.

## Migration 0012

`0012_keywords_and_themes.sql` adds `keywords_live`, `search_term_keywords`, `feed_state` and `review_notes`, rebuilds
`negatives_live` (match type, level, scope) and `script_ops` (new kinds and columns), and adds
`feed_tokens.first_used_at`. It is compatible with the code from before it, so it is applied to the remote database
before the code that needs it is pushed.

## Migration 0013

`0013_stripe_payments.sql` adds `stripe_payments`, `stripe_sync_state` and the `conn_stripe` connection. Nothing older
reads them, so it is applied to the remote database before the code is pushed. The `wineclub` Worker has to be
deployed first: the `STRIPE` binding names its `StripeRead` entrypoint.
