# Readiness checklist

Status as of 2026-11-14, after Milestone A plus the coordinator and policy core from Milestone C. "Built" means code exists and tests pass. It does not mean anything is connected or deployed.

## 1. Software built

- [x] Domain: money (integer minor units / micros, no mixed currencies), time zones and DST, metrics with explicit null reasons, measurement, capacity
- [x] D1 schema (31 tables) with demo/real separation
- [x] Policy engine: proposal validation, deterministic authorization, rolling cumulative limits counting everyone's changes, aggregate budget, spend exposure
- [x] Account coordinator (Durable Object): ledger and outbox, reservations, idempotency, unknown-outcome reconciliation, conditional compensation, protective pause, restore lock
- [x] Scheduler (one cron, logical run keys), LLM-free watchdog, daily and weekly review Workflows, template reports
- [x] Claude adapter: bounded tools, `submit_proposal` only, number-checked narrative (not yet run against the live API: no key in this environment)
- [x] Dashboard: 8 views, Android layout checked at Pixel 7 size, dark and light themes
- [x] Google Ads Script feed (script + endpoint), OpenTable CSV import, manual capacity
- [ ] Google Ads API adapter (contract only; blocked on access)
- [ ] Google Data Manager offline conversions (Phase 2)
- [ ] Notification delivery (no provider chosen; reports live in the app)
- [ ] Admin screen for capacity resources (seats, guides, rooms per day); today these are SQL rows
- [ ] Owner-set monthly AI cost ceiling (per-run caps exist)

## 2. Accounts connected — nothing yet

- [ ] Cloudflare resources created in the owner's account (D1, R2), IDs pasted in `wrangler.jsonc`
- [ ] Secrets set (`HUB_SECRET`, `FEED_TOKEN_PEPPER`, optional `ANTHROPIC_API_KEY`)
- [ ] Growth added to the Hub (service binding, app registry, grants)
- [ ] Google Ads account registered, script installed, first feed received
- [ ] OpenTable export imported (≥ 90 days)

## 3. Measurement usable

- [ ] Approved cost assumptions per product (otherwise contribution stays unknown)
- [ ] Attribution coverage reviewed: the share of bookings whose OpenTable source says Google paid search
- [ ] GA4 / GTM / conversion-action audit done and documented; no live tag changes without approval
- [ ] Maturation lag estimated from imported data (`products.lag_estimated_from_data`)
- [ ] A baseline period fixed and versioned

## 4. Autonomy enabled — not before 1–3, and not before the Google Ads API adapter exists

- [ ] Shadow mode run through complete daily and weekly cycles, including lag
- [ ] Policy set: ceiling and scope, return floor, approved campaigns, allowed actions, protective stop, baseline
- [ ] Other controllers identified (agency, scripts, automated rules) and `managed_by` set per campaign
- [ ] Canary mutation agreed: small, reversible, logged
- [ ] Owner presses *Enable Limited auto* on the exact policy version

## Owner questions (one batch)

1. Which Cloudflare account and domain should host it? Confirm it goes behind the Hub at `apps.dosbuhos.com/growth/`.
2. Who besides you should see it, and with which role (View, Edit, Admin)?
3. The Google Ads customer ID, its currency and time zone. Does an agency, script or automated rule change budgets today?
4. Is the website on WordPress? Who manages GA4 and Tag Manager, and may we audit them (read-only)?
5. Can someone export OpenTable reservations (GuestCenter → Reporting) for the last 90 days? Does the export include the *Source* column?
6. Per product, the approved variable-cost estimate: restaurant food+drink cost %, per-guest tour cost, commissions, and whether OpenTable amounts are net of commission.
7. Before any autonomy: the monthly ad ceiling (MXN), whether it covers the whole account, the minimum acceptable contribution return, and which campaigns the app may touch.
8. Optional: report language (default English), and whether you want a notification and where.
