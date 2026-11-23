# Dos Búhos Growth Terminal: handoff notes

_Status as of 2026-11-23. Context for continuing in another Claude chat (with Claude in Chrome)._

---

## 1. What this is

**Growth Terminal** is a private dashboard plus a bounded AI operator for Dos Búhos' ads, bookings and capacity.
- **Live at:** https://apps.dosbuhos.com/growth/ (sign in with Google through the Hub).
- **Direct Worker URL:** `growth.dos-buhos.workers.dev`. It only serves the Google Ads script feed; the dashboard needs the Hub.
- **Code:** GitHub `dosbuhos/dosbuhos-ops`, folder `growth/`. It deploys automatically via Cloudflare Workers Builds when code is pushed to `main`.
- **Rule of the design:** the AI *proposes* changes. A deterministic policy plus a coordinator decide. The owner approves every change (nothing is automatic yet).
- **Honesty rules:**
  - Missing data shows as "sin dato" or "Desconocido", never as 0.
  - Estimates are labelled "ESTIMACIÓN".
  - Money is stored in cents or micros.
- **Language:** the UI is in Spanish. The owner is Eric.

> **Code changes** (new features, fixes) still need a Claude Code session with the repo. A regular Claude chat with Chrome is fine for dashboards (Cloudflare, Google Ads, Klaviyo, Parrot, GA4), for reading data, and for decisions.

---

## 2. House rules (from the repo's CLAUDE.md)

- **Cloudflare account:** "Dos Buhos", ID `3d8be07bd3d63420eeb17a98058584fd`. workers.dev subdomain: `dos-buhos.workers.dev`.
- **Never change DNS, MX or Email Routing for dosbuhos.com** (email runs on Google Workspace).
- **Never run `wrangler deploy` by hand.** Deploys go through pushes to `main`.
- **Secrets:**
  - Never put secrets in chat, in the repo, or in wrangler vars.
  - Eric pastes values himself: Worker → Settings → Variables and Secrets → type **Secret**.
- **Text conventions:** staff-facing text is in Spanish; code comments are in English.
- **Time:** cron times are UTC. San Miguel de Allende is UTC-6 all year.

---

## 3. Key IDs and accounts

| Thing | Value |
|---|---|
| Google Ads account (the right one) | **782-120-6421** "Bodega Dos Búhos". *Not* Curalisto, which is a different account |
| Meta ad account | 3735139310045103 |
| GA4 property | 335490446 |
| OpenTable restaurant ID (public) | 1258120 |
| Parrot store | "bodega dos buhos (junto a zirandero)", store UUID `55259bbc-c95a-44a7-b448-9376d1bb67a9` |
| D1 database (growth) | `a55e5d23-3d7b-498c-aa66-e1145ae12bba` |
| D1 database (hub, read-only mirror source) | `1a971736-3a72-4e2c-9db8-2e6d746444cc` |
| Anthropic key | account Secrets Store, store `1109ee14b3d349b3815f622f59dc3168` |
| AI model | `claude-opus-5-5` (env `ANTHROPIC_MODEL`) |

**Secrets on Worker `growth`:**
- **Set:** `HUB_SECRET`, `GA4_SA_KEY`, `PARROT_API_KEY`.
- **Still to add:**
  - `FEED_TOKEN_PEPPER` (for the Google Ads script)
  - `KLAVIYO_API_KEY`
  - `RESEND_API_KEY` and `REPORT_EMAIL_TO` (weekly email)

---

## 4. Data sources: status

| Source | Status | What it gives |
|---|---|---|
| **Google Ads** via the Hub mirror | ✅ hourly | Spend, clicks and conversions per campaign. Campaigns are keyed by *name*, with no real IDs |
| **Google Ads script** (`growth/scripts/google-ads-feed.js`) | ❌ **NOT INSTALLED (top priority)** | Real campaign and budget IDs, search terms with cost, change history. **It is also the write path for approved changes** |
| **Meta Ads** via the Hub mirror | ✅ hourly | Spend per campaign. Reservations matched by campaign *name* when `utm_campaign={{campaign.name}}` |
| **GA4** (service account) | ✅ hourly | OpenTable widget events (`ot-availability-pageview` = opened the calendar, `ot-reservation-made` = reservation, `reserva_click`), by source, medium and campaign, since 2026-10-29. Also the Google Ads search terms with cost (`sessionGoogleAdsQuery`) |
| **Parrot POS API** | ✅ every 15 min | Orders (guests = `customersCount` on dine-in, trusted from **2026-11-04**), items, payments. History from Aug 11, 2026, when Parrot started |
| **OpenTable public availability** | ❌ blocked (403) | OpenTable refuses Cloudflare Workers. We don't work around it; capacity shows as unknown |
| **OpenTable reservations** | ⏳ via **Klaviyo** (pending) | Klaviyo's official OpenTable integration: all reservations, cancellations, no-shows, 2 years of history |
| **AI visibility check** | ✅ monthly (1st) + "Ejecutar ahora" | Claude with web search answers 10 traveler questions. Nov result: **10/10 recommend Dos Búhos** |
| **Weekly email** | ⏳ built, needs secrets | Monday 9:00 San Miguel, through Resend |

---

## 5. Approved values (editable in the app: Controles → "Valores estimados y costos")

**Value per reservation (without IVA):**

| Product | Value | Basis |
|---|---|---|
| Restaurant | **MX$1,560** | Parrot average ticket MX$1,806 with IVA (Aug 12–Nov 14) |
| Tours & tastings | **MX$2,500** | Rezdy: 3.6 people × MX$689. ⚠ Parrot shows about **MX$1,990** per tour booking (3.3 people × MX$700 with IVA). Eric kept 2,500 for now and may change it |

**Variable costs:**

| Cost | Value | Status |
|---|---|---|
| Restaurant food & drinks | 21% (range 19–24%) | provisional. Based on Lalo's recipe costs 20–25%, wine MX$100–120/bottle, and the Parrot sales mix |
| Tours | **12%** | provisional, pending accountant: wine about MX$44 (4 half glasses of ~75 ml) + guide about MX$27 (1 h × MX$89/h with IMSS ÷ 3.3 guests). No snacks |
| Card fees | **2.9%** of sales | **confirmed** from the Oct 2026 Parrot statement: 3.33% + IVA on card sales + tips; 68% of sales paid by card; IVA on the fee treated as recoverable |
| OpenTable per website reservation | MX$0 | provisional; confirm on an OpenTable invoice (network bookings cost MX$12/guest) |

**Contribution per reservation:** about **MX$1,187** for the restaurant and about **MX$2,200** for tours.

---

## 6. Key findings so far

- **Google Ads cost per online reservation: about MX$744** (7 reservations in about 16 days; small sample).
  - Spanish MOFU campaign: about MX$672.
  - English tours campaign: about MX$2,272. Only 1.6% of its clicks open the calendar, versus 3.2% for MOFU, so **check its landing page**.
- **Brand vs. generic searches (Oct 17–Nov 13):**
  - Searches for "Dos Búhos": 20% of spend (MX$930) → **33 calendar opens and all 5 matched reservations**.
  - Generic searches ("viñedos san miguel", Querétaro, "cerca de mi"): 80% of spend (MX$3,702) → **6 opens and 0 reservations**.
  - Clear waste: Querétaro searches (about MX$226) and "cerca de mi" (about MX$213) → negative keywords.
  - Suggested: a separate cheap brand campaign; test the generic searches with a new landing page or ad text, or move that budget.
- **GTM cleanup (done Nov 14) worked.** Reservations with a lost source ("dosbuhos.com / referral" or not set) went from **40% → 0%**. In the week after, **ChatGPT + Gemini brought 6 of 25 online reservations**. The "direct" share rose from 17% to 32% (watch it).
- **Tours ARE booked on OpenTable** (as Experiences, IDs 796500, 842882, 793495, 793530, 796410), but GA4 can't tell tour bookings from table bookings yet.
- **Pace reality:** about 2 Google reservations a week means reservations alone need 2–3 months to judge a change. **Use the early signal "cost per calendar opened"** (about 30 a day), which shows a 15–20% change within about 2 weeks. Confirm with reservations monthly. For real A/B tests, use **Google Ads Experiments** (50/50 split inside one campaign), not two campaigns against each other. Test big changes, one at a time.
- **Retargeting:** about 420 people a fortnight open the calendar and don't book; that's the best audience. Build it after the GTM cleanup (done). "BOFU Reservas Schedule" on Meta may already be retargeting; check its audience.
- **Tribalo is no longer the agency.** Campaign names still contain "DB+Tribalo".

---

## 7. AI operator: how approvals will work (built; waiting on the script)

1. The daily review (morning) proposes changes in **Actividad del agente**, each with a reason, expected effect, risks, and an evaluation plan.
2. Eric clicks **"Aprobar este cambio exacto"**. The change is queued ("En cola / por verificar").
3. The **Google Ads script** (hourly) applies it **only if the account still shows the approved "before" value**; otherwise it skips. It then reports the live account state.
4. The app marks it **verified** only when Google Ads shows the change. Changes not picked up within 6 h expire.
5. Possible changes: budget up or down, pause a campaign or ad, add an exact negative keyword. Meta stays read-only.

**Limits Eric approved (to paste as the policy in Controles once the script has run and real campaign IDs exist):**
- Monthly Google Ads ceiling **MX$15,000**, covering the whole account; protective stop at **95%**.
- Campaigns the app may touch: **MOFU Search** and **EN tours & tastings** only.
- Budget changes **≤20% per campaign per week**, **≤3 changes a day**, total budget increase over the base ≤20%.
- Minimum return: estimated contribution **≥ 1.0×** ad spend.
- Starting daily budget (base): **MX$365**.
- **Every change waits for approval** (`allowedAutomaticActions: []`). Mode: **Automático limitado**.

**Route A (parallel): Google Ads API developer token.**
- Create a Google Ads **manager account** and link 782-120-6421.
- Manager → Tools → **API Center** → apply for **Basic access** ("internal dashboard for our own account; budget and pause changes approved by the owner").
- With the token, changes apply instantly instead of hourly (switching over needs a Claude Code session).

---

## 8. TO DO: next steps, in order

### 8.1 Install the Google Ads script (top priority)
Prompt for Claude in Chrome:

> **Task: install the Growth Terminal's Google Ads script for Dos Búhos.** Work only in Cloudflare (account Dos Buhos), the Growth app, and Google Ads account **782-120-6421** (not Curalisto). Don't change any campaign, budget, keyword or setting in Google Ads. **Never paste a secret or token into chat or into your final report.**
>
> **1. Cloudflare secret:** dash.cloudflare.com → Workers & Pages → **growth** → Settings → Variables and Secrets → **Add**. Type **Secret**, name `FEED_TOKEN_PEPPER`, value: a random 48-character string of letters and digits that you generate. Save and deploy. Don't touch other variables.
>
> **2. Feed token:** wait about 30 s, then open https://apps.dosbuhos.com/growth/#connections. In the "Google Ads Script" row, click **"Crear token del feed"** and confirm. It's shown **once**; copy it only into the script in step 4. If it says the feed is not configured, wait a minute and retry.
>
> **3. Script code:** open https://github.com/dosbuhos/dosbuhos-ops/blob/main/growth/scripts/google-ads-feed.js, click **Raw**, and copy the whole file.
>
> **4. Google Ads:** account 782-120-6421 → Tools → Bulk actions → **Scripts** → **+** New script.
> - Name it `Growth Terminal`.
> - Replace the template with the file.
> - Replace `PASTE_TOKEN_HERE` (in `var FEED_TOKEN = '...'`) with the token, keeping the quotes. Leave `APPLY_CHANGES = true`.
> - **Authorize**, then **Preview**. A preview applies nothing but does send data.
> - The last log line should read `Growth Terminal answered 200: {"ok":true,...`. On 401 or 403, stop and report the log, without the token.
> - On 200: **Save** → **Run** once → **Frequency: Hourly**.
>
> **5. Report**, without secrets: the last log line from Preview and from Run, the saved frequency, and whether the "Google Ads Script" row in Conexiones shows connected.

After it runs:
- Confirm in D1 that `campaign_registry` has real IDs (`res_c<id>`) and that the Hub's name-keyed Google rows were removed (no double counting).
- Then build the policy JSON with the real campaign IDs and the limits from §7. Eric pastes it in Controles → "Editar la política completa", sets the base to MX$365, and switches to **Automático limitado**.

### 8.2 Klaviyo key (OpenTable reservations)
1. In Klaviyo → **Integrations**, confirm **OpenTable** is connected. If not, Complete setup; that needs an OpenTable admin and authorizing Klaviyo for the Sync API.
2. Settings → **API keys** → **Create Private API Key** → name `Growth Terminal (solo lectura)` → **Custom Key**:
   - **Read Access:** Events, Metrics, Profiles, Campaigns, Flows, Lists, Segments, Templates.
   - **No Access:** Coupons, Webhooks, Data Privacy, and everything else. **Never Full Access.**
3. Copy the key (`pk_…`) → Cloudflare → growth → Secret `KLAVIYO_API_KEY`.
4. Then, in a Claude Code session, build the Klaviyo connector:
   - read the OpenTable metrics and events (confirm field names from real data first);
   - fill the app's empty bookings section with all reservations, party size, cancellations and no-shows;
   - add booked guests by day and booking pace;
   - feed capacity into the AI review.

### 8.3 Weekly email
- Add the secrets `RESEND_API_KEY` (spark's Resend key) and `REPORT_EMAIL_TO` (Eric's email). Resend's free sender only delivers to the Resend account owner's address.
- Test: Controles → "Resumen semanal por correo" → "Enviar una prueba ahora".

### 8.4 Quick wins Eric can do by hand now
- **Negative keywords** in the MOFU campaign: Querétaro searches ("viñedos queretaro", "viñedos en queretaro"), and "cerca de mi" / "viñedo cerca de mi".
- **Meta:** set the URL parameter `utm_campaign={{campaign.name}}` on all ads, so reservations match per campaign.
- **English campaign landing page:** review it (language, price, booking button). Only 1.6% of clicks open the calendar.

### 8.5 Pending decisions and confirmations
- The accountant validates the guide cost and the IVA on Parrot's fee.
- Tour value: keep MX$2,500 or switch to about MX$1,990 (Parrot).
- OpenTable invoice: are website reservations free?
- The OpenTable ad-tech email draft is in Eric's Gmail (to jbaker@opentable.com). It's less urgent now that the GTM cleanup fixed lost sources.

---

## 9. App features already built (for reference)

- **Resumen:**
  - tickers: online reservations, Google reservations, cost per reservation, estimated revenue, return and contribution, AI assistants, Parrot guests, tour guests and sales;
  - guests by weekday (last vs. the average of the previous 4);
  - OpenTable funnel.
- **Campañas:**
  - per campaign: spend, clicks, calendar opens, reservations, cost per reservation, estimated revenue, return and contribution (Google and Meta);
  - reservation sources;
  - "¿Pagamos por búsquedas de nuestro nombre?" (brand vs. other searches with cost);
  - AI visibility results.
- **Capacidad:** OpenTable availability (currently blocked → shown as unknown).
- **Actividad del agente:** proposals, approve, verify, reconcile, restore.
- **Controles:**
  - emergency stops (stop AI changes, pause managed ads, emergency lock);
  - autonomy mode and policy editor;
  - values and costs editor, with history;
  - AI visibility "Ejecutar ahora";
  - weekly email preview and test.
- **Conexiones:** connection health and the "Crear token del feed" button.
- **Scheduler (cron every 15 min):**
  - ads_ingest (hourly)
  - pos_sync (15 min)
  - ot_availability (3 h)
  - daily and weekly review
  - ai_visibility (monthly)
  - weekly_email (Mon 09:00)
  - watchdog

### Possible next builds (need Claude Code)
- **Early signal:** "Costo por apertura del calendario" per campaign, daily, as the main metric for tests.
- **Test plans:** each AI proposal comes with a test plan approved together (metric, duration, success threshold). Don't touch a campaign mid-test. Show before/after matched by weekday.
- **Google Ads Experiments:** read the results.
- **Klaviyo/OpenTable connector** (§8.2).
- **Email performance from Klaviyo:** campaigns and flows → reservations.
- **Retargeting audience:** opened the calendar and didn't book in the last 30 days (Meta + Google).

---

## 10. Useful queries (D1 `a55e5d23-…`)

```sql
-- Online reservations by source, last 14 days
SELECT source || ' / ' || medium AS src, SUM(events) n FROM ga4_reservations_daily
WHERE event_name='ot-reservation-made' AND date >= date('now','-14 day') GROUP BY src ORDER BY n DESC;

-- Brand vs. other paid searches with cost
SELECT CASE WHEN lower(query) LIKE '%buho%' OR lower(query) LIKE '%búho%' THEN 'marca' ELSE 'otras' END g,
  ROUND(SUM(ad_cost_micros)/1e6) cost, SUM(opened) opened, SUM(reservations) res
FROM ga4_ads_queries WHERE date >= date('now','-28 day') GROUP BY g;

-- Parrot guests and sales by day
SELECT local_date, SUM(CASE WHEN order_type='DINE_IN' THEN customers END) guests, ROUND(SUM(total_minor-taxes_minor)/100.0) net
FROM pos_orders WHERE status='FINISHED' GROUP BY local_date ORDER BY local_date DESC LIMIT 14;

-- Job health
SELECT job, status, substr(detail,1,150), datetime(started_at/1000,'unixepoch') FROM job_runs ORDER BY started_at DESC LIMIT 15;
```
