# Readiness checklist

Updated 2026-11-14 (evening). "Built" means code exists and tests pass; section 2 says what is actually connected in production.

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

- [ ] Cloudflare resour## 2. Accounts connected (production, Worker `growth`)

- [x] Cloudflare: D1 `growth`, R2 `growth-archive`, Worker created via Workers Builds, `HUB_SECRET` set, behind the Hub at `/growth/`
- [x] Google Ads reads (account 782-120-6421) via the Hub's existing script feed, hourly, read-only (`HUB_DB`)
- [x] Meta Ads reads via the Hub's Meta sync, hourly, kept separate from Google (account registered; first copy on the next hourly run)
- [x] OpenTable online reservations + booking funnel via GA4 property 335490446 (`GA4_SA_KEY`, read-only Viewer); tracking of `ot-reservation-made` began 2026-10-29
- [x] OpenTable public availability (bookable times, next 14 days, every 3 h), same queries as `canario`
- [x] Anthropic key from the account Secrets Store (report narrative; proposals only in Shadow mode)
- [ ] Sign-in at apps.dosbuhos.com: add `https://apps.dosbuhos.com/auth/callback` to the Google OAuth client (until then use hub.dos-buhos.workers.dev/growth/)
- [ ] Growth's own richer Google Ads Script feed (optional; needs `FEED_TOKEN_PEPPER`)
- [ ] OpenTable full reservations (status, covers, cancellations, spend): asked of OpenTable (email draft to the account manager + ad-tech team); CSV import as fallback
- [ ] Parrot POS sales (restaurant spend per guest): report export requested via the browser session

## 3. Measurement usable

- [x] Online reservations by source and campaign (GA4), cost per online reservation per Google Ads campaign
- [x] Tours and tastings spend per guest from Rezdy history (last 12 months to 2026-11-02, paid confirmed orders): weighted MX$799 incl. IVA (MX$689 excl.), average party 3.6. Guided tour + 4 wines MX$683, picnic MX$841, 5-course pairing menu MX$1,919, 4-wine tasting MX$628, petanque MX$391 per guest (incl. IVA). Not loaded into the app yet: needs the variable-cost % to become contribution
- [ ] Restaurant spend per guest (Parrot export)
- [ ] Approved cost assumptions per product (otherwise contribution stays unknown)
- [ ] Attribution: ~40% of online reservations lose their source between dosbuhos.com and OpenTable ("dosbuhos.com / referral", "not set"). Our side is configured (links carry `_gl`; cross-domain and unwanted referrals set); whether OpenTable's page reads `_gl` is asked in the OpenTable email
- [ ] GTM cleanup: two leftover Meta CAPI tags send 5 extra page_views and `gtm.dom` per page to GA4 (being paused after checking Meta Events Manager). Growth does not use page views, so its numbers are unaffected
- [ ] Maturation lag estimated from booking data (needs booking-level data)
- [ ] A baseline period fixed and versioned

gle Ads API adapter exists

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
