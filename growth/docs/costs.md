# Costs — Dos Búhos Growth Terminal

**Prices as read on 2026-11-14** from Cloudflare's official documentation (developers.cloudflare.com). All prices are in USD and exclude any sales tax or VAT applied based on the billing address. Re-check before budgeting: the Workers pricing page was last updated by Cloudflare on 2026-11-13.

Cost categories are kept separate on purpose:

1. **Ad spend:** media money paid to Google/Meta. Not a software cost.
2. **Infrastructure:** Cloudflare.
3. **Model usage:** Anthropic API (placeholder).
4. **Optional notifications.**
5. **One-time setup labor.**
6. **Ongoing maintenance.**

---

## 1. Ad spend (not software cost)

- Set by the owner per campaign. The app only reads and reports it.
- Planning rule for Google Ads: a single day may spend **up to 2× the average daily budget**. Monthly charges are capped at **30.4 × average daily budget** for most campaigns. Source: https://support.google.com/google-ads/answer/1704424/. **Could not fetch this page today** (host blocked in this session); the figures come from a search-index summary of the official page. Verify before relying on them.
- Meta budgets follow Meta's own rules (not researched here).

## 2. Infrastructure — Cloudflare official pricing (as read on 2026-11-14)

### Workers Paid plan
Source: https://developers.cloudflare.com/workers/platform/pricing/

| Item | Included per month | Overage |
|---|---|---|
| Subscription | **$5.00 / month minimum per account** (covers Workers, Pages Functions, KV, Hyperdrive, Durable Objects usage allotments) | — |
| Requests (Standard model) | 10 million | $0.30 / additional million |
| CPU time | 30 million CPU-ms | $0.02 / additional million CPU-ms |
| Duration | No charge | — |
| Limits | Max 5 min CPU per invocation (default 30 s); **max 15 min CPU per Cron Trigger invocation** | — |

Subrequests (outbound `fetch`) are not billed. A Workers spending limit can be set; it excludes the subscription fee.

### Cron Triggers
Sources: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/workers/configuration/cron-triggers/
- **No separate price line.** Cron executions run as Worker invocations and use the request/CPU allotments above.
- Limit: **250 Cron Triggers per account** on Workers Paid (5 on Free).

### D1
Source: https://developers.cloudflare.com/d1/platform/pricing/ (page updated 2026-10-30)

| Metric | Included (Paid) | Overage |
|---|---|---|
| Rows read | 25 billion / month | $0.001 / million rows |
| Rows written | 50 million / month | $1.00 / million rows |
| Storage | 5 GB | $0.75 / GB-month |
| Databases | 100,000 | $0.10 / extra database / month |

No egress charges. Indexes add one written row per indexed write.

### Durable Objects (SQLite-backed)
Source: https://developers.cloudflare.com/durable-objects/platform/pricing/

| Metric | Included (Paid) | Overage |
|---|---|---|
| Requests (HTTP, RPC sessions, WS messages, alarms) | 1 million / month | $0.15 / million |
| Duration | 400,000 GB-s / month | $12.50 / million GB-s (billed at 128 MB per object; rounded **up** to the next million GB-s) |
| SQLite rows read | 25 billion / month | $0.001 / million |
| SQLite rows written | 50 million / month | $1.00 / million (each `setAlarm()` = 1 row written) |
| SQL stored data | 5 GB-month | $0.20 / GB-month |

SQLite storage billing was scheduled to start January 2026 (target 2026-01-07). Idle objects that can hibernate incur **no duration charges**. Pending I/O can keep an object in memory for up to 15 minutes.

### Workflows
Source: https://developers.cloudflare.com/workflows/reference/pricing/ (page updated 2026-11-04) ; changelog https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/

| Metric | Included (Paid) | Overage |
|---|---|---|
| Requests (invocations) | 10 million (shared with Workers) | $0.30 / million |
| CPU time | 30 million CPU-ms (shared with Workers) | $0.02 / million CPU-ms |
| Steps | 500,000 / month | $0.80 / additional 100,000 |
| Storage | 1 GB-month | $0.20 / GB-month |

Step and storage billing starts **no earlier than 2026-08-10**. Retries and rollback handlers don't count as steps. Instance state is retained 7 days by default on Paid (configurable up to 30).

### R2
Source: https://developers.cloudflare.com/r2/pricing/ (page updated 2026-10-30)

| Metric | Free tier / month | Standard storage price |
|---|---|---|
| Storage | 10 GB-month | $0.015 / GB-month |
| Class A ops (writes/lists) | 1 million | $4.50 / million |
| Class B ops (reads) | 10 million | $0.36 / million |
| Egress | Free | Free |

Usage is rounded up to the next billing unit.

### Monthly estimate for this app

Assumed profile: cron every 15 min; hourly ingestion; a few hundred dashboard API requests/day; D1 < 1 GB; R2 < 5 GB; 1–2 Durable Objects (one per ad account); daily + weekly Workflow runs. Usage figures below are **engineering estimates**, not measurements.

| Dimension | Low | Base | High | Included | Billable? |
|---|---|---|---|---|---|
| Cron invocations (96/day) | 2,880 | 2,880 | 2,880 | — | counts as requests |
| Ingestion POSTs (hourly × accounts × entities) | 720 | 2,200 | 4,400 | — | counts as requests |
| Dashboard API requests | 6,000 (200/day) | 12,000 (400/day) | 30,000 (1,000/day) | — | counts as requests |
| **Worker requests total** | ~10k | ~17k | ~37k | 10M | No |
| Worker CPU (avg 20 / 50 / 300 ms) | ~0.2M ms | ~0.9M ms | ~11M ms | 30M ms | No |
| D1 rows written | 50k | 300k | 3M | 50M | No |
| D1 rows read | 50M | 300M | 5B | 25B | No |
| D1 storage | 0.2 GB | 0.5 GB | 1 GB | 5 GB | No |
| DO requests | 4k | 10k | 50k | 1M | No |
| DO duration | ~500 GB-s | ~2,600 GB-s | ~660k GB-s* | 400k GB-s | Only high case |
| Workflow instances (≈30 daily + 4–5 weekly) | 35 | 35 | 70 (with reruns) | — | counts as requests |
| Workflow steps | ~700 | ~3,500 | ~15,000 | 500k | No |
| R2 storage | 1 GB | 3 GB | 5 GB | 10 GB | No |
| R2 Class A / B ops | <5k / <20k | <10k / <50k | <50k / <500k | 1M / 10M | No |
| **Monthly infrastructure** | **$5.00** | **$5.00** | **≈ $17.50** | | |

\* High case assumes a design bug: both Durable Objects stay in memory all month without hibernating (2 × 2,592,000 s × 0.128 GB ≈ 663,552 GB-s). The 263,552 GB-s billable is rounded up to 1M GB-s, which costs $12.50. Avoid this by not holding open connections or timers in the DO, and by letting it hibernate between alarms.

**Note:** the $5 minimum is per **account**. If `hub/` already runs on Workers Paid in the same Cloudflare account, the growth app's marginal infrastructure cost at this profile is about **$0**.

## 3. Model usage

Prices from the Claude API pricing reference (model table cached 2026-11-03; re-check at https://platform.claude.com/docs/en/about-claude/pricing before relying on them). The model is configurable (`ANTHROPIC_MODEL`); the default is `claude-opus-5-5` at **$4 / MTok input, $20 / MTok output**. Cheaper alternatives in the same table: `claude-sonnet-5-5` $2 / $10, `claude-haiku-5-5` $0.10 / $0.50.

What calls the model (nothing else does; the 15-minute watchdog never does):

| Run | When | Shape | Per-run estimate (Opus 5.5) |
|---|---|---|---|
| Daily review | once per winery-local day, only in SHADOW / LIMITED_AUTO / DEMO with a key | ≤ 10 tool calls, aggregates only (≈ 6 requests × 8k input, ≈ 4k output incl. thinking at effort *medium*) | ≈ 48k in + 4k out ≈ **$0.27** |
| Report narrative | daily + weekly | ≈ 3k in, ≈ 0.5k out, effort *low* | ≈ **$0.02** |
| Weekly review | Monday | same shape as daily | ≈ **$0.27** |

| Scenario | Assumption | $/month |
|---|---|---|
| Low | No `ANTHROPIC_API_KEY` (template reports, no proposals) or mode OBSERVE | **$0** |
| Base | Daily + weekly review and narratives as above | ≈ 30 × 0.29 + 4 × 0.29 ≈ **$10** |
| High | Every run hits the 10-tool-call cap with ≈ 15k-token context and 8k output | ≈ 34 × 0.80 ≈ **$27** |

Hard stops in code (`src/ai/claude.ts`): per-run cost budget 0.50 USD, 10 tool calls, 120 s wall time, 16k max output tokens per request, at most two proposals per run; any failure falls back to the template report. Token usage and cost per run are recorded in `job_runs` and shown under Agent activity → Scheduled runs. A monthly AI cost ceiling the owner sets is planned (owner input, see `docs/readiness.md`).

## 4. Optional notifications

Not priced. No provider has been chosen and no pricing pages were read. Options to quote later: email (transactional provider), WhatsApp/SMS (e.g. WhatsApp Business Platform), and push to an existing channel. At a few alerts a day, cost is expected to be small. Quote it from the chosen provider's official pricing page before enabling.

## 5. One-time setup labor (estimate, hours)

| Task | Hours (low–high) |
|---|---|
| Ads Script v2 payload (IDs, cost micros, budgets, search terms, change history) + Worker ingest + tests | 8–16 |
| D1 schema/migrations, R2 raw archive, DO per account | 6–12 |
| Workflows (daily/weekly) + cron wiring | 4–8 |
| Dashboard API + UI | 12–24 |
| OpenTable CSV export → R2 → parser | 4–8 |
| Account verification (GA4/GTM existence, Zoho DC/plan, Rezdy status, Parrot export) | 2–6 |
| **Total** | **36–74** |

Future adapters (Google Ads API access application, Data Manager offline conversions, Zoho, Meta reuse) are extra. Their effort depends on approvals.

## 6. Ongoing maintenance (estimate)

| Item | Effort |
|---|---|
| Monitoring failed ingests / quota errors | ~1–2 h / month |
| Google Ads API version migrations (monthly releases; each major version sunsets on a published schedule), only once the API adapter exists | ~2–4 h per migration |
| Meta Marketing API version bumps (shared with `hub/`) | ~2–4 h per bump |
| Ads Script edits after Google Ads changes | ~1–2 h / quarter |
| Re-verifying prices and policies (this file, `integrations.md`) | ~1 h / quarter |
