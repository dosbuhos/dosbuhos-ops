# Setup and deployment

Follows the repo's `CLAUDE.md`: Workers Builds deploys from `main`; nobody runs `wrangler deploy` by hand; Eric pastes secret values himself.

## Already done (2026-11-14)

- D1 `growth` created (id in `wrangler.jsonc`), `0001_init.sql` applied remotely and recorded in `d1_migrations`, marked `data_kind = 'real'`.
- R2 bucket `growth-archive` created.
- Dos Búhos Google Ads account registered in D1 (`ad_accounts`, id `acct_google_main`). The customer ID lives only in D1, never in this public repo.
- Google Ads data: read-only binding `HUB_DB` to the Hub's database, where the Hub's Google Ads Script already writes the account hourly. Growth mirrors it every hour (`src/connectors/hub-mirror.ts`).

## Eric: one-time steps

1. **Create the Worker.** Workers & Pages → Create → Continue with GitHub → `dosbuhos-ops`. Set the Worker name to `growth` and Build → Root directory to `/growth`. The build command stays empty: the dashboard is prebuilt in `public/`. Cancel the first automatic build if the root directory is still `/`.
2. **Secret.** Worker `growth` → Settings → Variables and Secrets → add `HUB_SECRET` with the same value as the Hub's `SESSION_SECRET`. Until this is set, the app refuses every request (it fails closed).
3. **Optional secret.** `ANTHROPIC_API_KEY`, for the AI review and the written report summary. You can also bind it from the account Secrets Store. Without it, reports use the factual template and no proposals are drafted.
4. **Put it behind the Hub** (after step 1 has deployed once). Add `{ "binding": "GROWTH", "service": "growth" }` to `services` in `hub/wrangler.jsonc`. Then Hub → Admin → Apps → slug `growth`, binding `GROWTH`, mode `proxy`. Then grant yourself Admin on it. Claude can do the `hub/` change and the registry row once step 1 is done.

Then open `https://apps.dosbuhos.com/growth/`.

## Local demo

Synthetic data and a simulated ad account; never deploys.

```bash
cd growth
npm install
npm run dev
```

## Changing the app

```bash
npm run check
```

`npm run check` runs the typecheck and tests, rebuilds the dashboard into `public/`, and fails if `public/` was not committed. For a schema change, add `migrations/0002_….sql`, apply it to the remote `growth` database, and record it in `d1_migrations` before pushing code that needs it.

## Data sources: status

| Source | Status | How |
|---|---|---|
| Google Ads (reads) | Live via the Hub | Daily spend, clicks and Google-counted conversions per campaign (by name), today included, hourly |
| Google Ads (richer reads) | Optional | Install `scripts/google-ads-feed.js` in Google Ads for campaign IDs, micros, search terms and change history (needs the `FEED_TOKEN_PEPPER` secret) |
| Google Ads (changes) | Blocked | Needs Google Ads API access for the Cloud project `dos-buhos` plus owner OAuth |
| OpenTable online reservations | Live | OpenTable's GA4 integration sends `ot-reservation-made` (since 2026-10-29) plus the widget funnel events; Growth reads daily counts by source/medium/campaign from GA4 property 335490446 with a read-only service account (`GA4_SA_KEY`). Online widget bookings only; no cancellations, no-shows or spend |
| Meta Ads (reads) | Live via the Hub | Daily spend per campaign (by name), MXN at each day's rate, kept separate from Google; Meta ads tag visits by campaign ID, so per-campaign reservations can't be matched yet |
| AI summaries | Live | Shared `ANTHROPIC_API_KEY` from the account Secrets Store (same as the cotizador) |
| OpenTable full reservations | Requested | Status, covers and cancellations need OpenTable's partner API (GuestCenter → API Partner) or the CSV import |
| Capacity | Automatic + manual | Bookable times on OpenTable's public booking page every 3 h (same queries as `canario`; update both if OpenTable changes its hashes); staff can still enter slots |
