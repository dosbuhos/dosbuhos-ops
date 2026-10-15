# Club Dos Búhos · shipment logistics

Mobile staff app at https://wineclub.dos-buhos.workers.dev. Stripe identifies subscriptions; a confirmed club mapping and fulfillment anchor generate every expected shipment. A payment never proves delivery.

## Staff workflow

- Agenda: overdue first, then today and future dates. Unresolved mappings explicitly make counts incomplete.
- Envíos: search by member, club, email, PO, or tracking; filter pending, prepared, ready, dispatched, delivered, or exceptions.
- Open a shipment to define/substitute packing contents, then choose handover or dispatch. Review packing, record the actual date, and optionally include PO, tracking, notes, and a photo. Status, details, audit, and photo save together. Stale submissions are rejected.
- Reopen a mistaken fulfillment with a reason. Its original packing snapshot remains available. Calculated dates are never bulk-converted into deliveries.
- Ajustes → Migración: preview legacy history; repeated imports do not duplicate shipments or overwrite staff work. Monthly recipes belong to calendar months; quarterly recipes follow shipment sequence.

## Development and verification

Use Node.js and `npm ci`, then `npm test` and `npm run test:integration`.

The integration runner creates a temporary local configuration, fictional Stripe server, and isolated D1 database. It requires no Stripe or Google credentials and cleans up its processes on Windows and Unix. Its clock is fixed to October 14, 2026. Production always uses America/Mexico_City.

For a local preview use a separate configuration with no Google/Access settings, `DEV_USER` and `ADMIN_EMAILS` set to a local test email, and an isolated local database. Never deploy a development-auth configuration.

## Cloudflare

- Production Worker: `wineclub`; D1: `wineclub-production`. Configuration: `wrangler.toml`.
- Production migrations: `npx wrangler d1 migrations apply DB --remote --env ""`.
- Production deployment: `npx wrangler deploy --env ""`.
- Both commands modify production. Back up data before migrations/imports. Main is also connected to Workers Builds; do not push an older source state over manually deployed fixes.
- Staging: `wineclub-staging` Worker and D1. It requires its own migrations and valid authentication configuration before use; checked-in staging authentication is deliberately locked.
- Google sign-in takes precedence when `GOOGLE_CLIENT_ID` is set. Required secret: `GOOGLE_CLIENT_SECRET`. A separate `SESSION_SECRET` is recommended for cookie signing. `ALLOWED_EMAILS` controls staff access; `ADMIN_EMAILS` controls managers. Cloudflare Access is the alternative when Google is not configured.
- `STRIPE_SECRET_KEY` is a restricted read-only key for customers, subscriptions, invoices, products, and prices. Store secrets in Cloudflare, never Git.
- Hourly Stripe sync is configured. Optional webhook requires `STRIPE_WEBHOOK_SECRET` and access to `/stripe/webhook` through any hostname-level Access policy.
- Photos currently use D1 BLOB storage. Optional Workers AI powers the read-only question assistant; it is not part of shipment calculation or fulfillment.

## Known business decisions

Missing wine recipes remain visibly unresolved; do not invent selections or copy a different club's box without approval. Keep Stripe prices and cancellation/payment states intact when they conflict with legacy records. Repeated or nonstandard PO references are preserved for staff review.
