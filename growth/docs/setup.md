# Setup and deployment (one-time, administrator)

Everything here is done by the owner, or an administrator acting for the owner, in the owner's own accounts. Never paste a password, token or key into chat or into this repository; it is public.

## 0. Local demo (no accounts needed)

```bash
cd growth
npm install
npm run dev
```

Open http://127.0.0.1:8787. Synthetic data loads on first visit and every screen says DEMO. Run tests with `npm test`; run everything (typecheck, tests, build) with `npm run check`.

## 1. Cloudflare resources (owner's account)

Create one set per environment. Demo shown; for staging and production replace `growth-demo` with `growth-staging` or `growth`.

```bash
npx wrangler d1 create growth-demo
```

```bash
npx wrangler r2 bucket create growth-demo-archive
```

Paste the printed `database_id` into `wrangler.jsonc` under `env.demo` (replace `REPLACE_WITH_growth-demo_ID`). Then apply migrations and mark the database's kind:

```bash
npm run db:demo
```

```bash
npx wrangler d1 execute growth-demo --remote --env demo --file fixtures/demo-seed.sql
```

For staging and production, use `fixtures/real-settings.sql` instead of the demo seed. That file marks the database as real; synthetic data can never be loaded into it.

## 2. Secrets (dashboard → Workers → growth-… → Settings → Variables and Secrets, or `wrangler secret put NAME --env …`)

| Name | Needed for | Value |
|---|---|---|
| `HUB_SECRET` | every non-dev environment | the Hub Worker's `SESSION_SECRET` |
| `FEED_TOKEN_PEPPER` | Google Ads Script feed | a long random string, e.g. `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY_V1` | storing OAuth refresh tokens (Phase 2) | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | optional: AI review and narrative | an Anthropic API key from the owner's Console |

## 3. Deploy

Workers Builds, the same way as the other apps in this repo: Create → Import repository → `dosbuhos-ops`, root directory `growth`, build command `npm run build`, deploy command `npx wrangler deploy --env demo` (or `--env production`). Alternatively, from a machine with the owner's Cloudflare login:

```bash
npm run deploy:demo
```

Production has `workers_dev: false` and `preview_urls: false`, so the Hub is the only way in.

## 4. Put it behind the Hub (no change to Hub code needed beyond configuration)

1. In `hub/wrangler.jsonc` add a service binding once the Worker exists: `{ "binding": "GROWTH", "service": "growth" }` (or `growth-demo`). Adding it before the Worker exists breaks the Hub's deploy, which is why this repo doesn't add it yet.
2. Hub → Admin → Apps: add slug `growth`, section Marketing, binding `GROWTH`, mode `proxy`.
3. Hub → Admin → People: give the owner **Admin** on `growth`. Others get View (read) or Edit (capacity and imports).
4. Open `https://apps.dosbuhos.com/growth/`.

## 5. Connect real data (staging, then production)

1. **Register the ad account.** Insert one `ad_accounts` row with the Google Ads customer ID (digits only), currency and account time zone. It lives in D1, never in the repo. Example: `INSERT INTO ad_accounts (id, provider, external_id, name, currency, account_tz, created_at) VALUES ('acct_google_main', 'google_ads', '<customer id>', 'Dos Búhos', 'MXN', 'America/Mexico_City', 0);`
2. **Google Ads feed.** Connections → Google Ads Script → *Create feed token* (shown once). In Google Ads → Tools → Bulk actions → Scripts, paste `scripts/google-ads-feed.js`, set `ENDPOINT` and `FEED_TOKEN`, authorize, run once and schedule *Hourly*. The script only reads.
3. **Bookings.** OpenTable GuestCenter → Reporting → Reservations → export CSV covering at least the last 90 days. Then Connections → *Import OpenTable reservations*: choose the file's time zone and date format, preview, then import. Repeat weekly, or more often; re-imports update statuses without creating duplicates.
4. **Capacity.** Capacity → for each open day, add slots, or *Still correct* to confirm. Seats, guides and rooms per day are rows in `capacity_resource_windows` (an admin screen for those is on the backlog).
5. **Margins.** Insert approved `cost_assumptions` per product (variable cost %, per-guest cost, source, approver). Until these exist, contribution shows as *unknown* and the hero chart shows completed guests.

## 6. Going live (only after the readiness checklist)

Set the policy in Controls: ceiling, ceiling scope, return floor, approved campaigns, allowed actions, protective stop. Set the aggregate budget baseline. Production writes also need the Google Ads API adapter, which is blocked today (see `docs/integrations.md`). Controls → *Enable Limited auto* shows the exact policy version and requires an explicit confirmation.
