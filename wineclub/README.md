# wineclub · Club Dos Búhos

Mobile-first staff app: every expected club shipment (past, overdue, today, upcoming) computed from Stripe start date + club cadence; staff mark shipped / handed over; member history; benefit-usage log.

- Production: `wineclub` worker, D1 `wineclub-production`. Staging: `npx wrangler deploy --env staging`, D1 `wineclub-staging`.
- Schema: `migrations/` (`wrangler d1 migrations apply DB --remote [--env staging]`).
- Secrets (dashboard → Worker → Settings → Variables and Secrets): `STRIPE_SECRET_KEY` (restricted, read-only: Customers, Subscriptions, Invoices, Products, Prices). Optional `STRIPE_WEBHOOK_SECRET` (needs an Access bypass on `/stripe/webhook`); without it the app syncs hourly.
- Login: Cloudflare Access. `ACCESS_AUD` in wrangler.toml; empty = app stays locked. Managers = `ADMIN_EMAILS`.
- Local: `npm i && npm run migrate:local && npm run dev` with `.dev.vars` (DEV_USER, no ACCESS_TEAM_DOMAIN). Tests: `npm test`.
- Assistant (`/preguntar`, optional): Workers AI binding `AI` (model `AI_MODEL`, default llama-3.3-70b). For an external OpenAI-compatible API set `AI_API_URL`, `AI_MODEL` and secret `AI_API_KEY`. The model can only call 5 read-only functions in `src/assistant.js`; no SQL, no writes.
