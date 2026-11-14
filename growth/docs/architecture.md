# Architecture

```
 Google Ads account ──(hourly Google Ads Script, bearer token)──► POST /api/feed/google-ads ─┐
 OpenTable GuestCenter export ──(CSV, preview → commit)──────────► /api/imports/…           ├─► D1 (facts, config, projections)
 Staff capacity calendar ─────────────────────────────────────────► /api/capacity/…          ┘        │
                                                                                                       ▼
 Cron */15 (UTC) ─► runSchedule: claim logical run keys in job_runs ─► watchdog (no LLM) ─► alerts
                                                      └─► Workflow instance (id = run key): report ─► model review (optional)
                                                                                                       │ submit_proposal
                                                                                                       ▼
 validateProposal (schema, server-issued refs, snapshot evidence) ─► evaluatePolicy (deterministic) ─► AccountCoordinator DO
                                                                                                       │  ledger + outbox (atomic)
                                                         only holder of the AdsProvider (mock | Google Ads API) ◄┘
 Dashboard (React, behind the Hub) ◄── /api/* (Hub-signed identity, roles, same-origin writes) ◄── D1 + coordinator state
```

## Components (spec §3)

| # | Component | Code |
|---|---|---|
| 1 | Connector adapters | `src/connectors/` — Google Ads Script feed, OpenTable CSV, Google Ads API (contract, blocked), mock provider |
| 2 | Measurement engine | `src/domain/measurement.ts`, `src/domain/metrics.ts`, `src/read/facts.ts` |
| 3 | Capacity engine | `src/domain/capacity.ts` |
| 4 | Deterministic evaluator | `src/read/facts.ts`, `src/read/snapshot.ts` (evidence snapshots with server-issued refs) |
| 5 | Claude | `src/ai/claude.ts` — read tools + `submit_proposal` only; narrative with number validation |
| 6 | Policy engine | `src/policy/validate.ts`, `src/policy/evaluate.ts`, `src/policy/exposure.ts` |
| 7 | Account coordinator | `src/coordinator/core.ts` (logic), `src/coordinator/do.ts` (Durable Object) |
| 8 | Dashboard / reporting | `web/`, `src/api/app.ts`, `src/workflows/reports.ts` |

## Storage ownership (spec §4)

- **Durable Object (one per ad account)** is authoritative for: autonomy mode, emergency lock, AI-stopped flag, policy versions, aggregate budget baseline, action state, resource reservations, idempotency keys, the budget-change ledger used for rolling limits, suspensions, and the restore lock.
- **D1** is authoritative for business facts and analytics configuration: bookings, campaign facts, capacity, cost assumptions, experiments, reports, alerts, job runs, imports. It holds a *projection* of the coordinator ledger (`action_ledger_projection`) and audit events.
- **R2** holds raw feed payloads, import files and coordinator backups.
- Writes are not one transaction across these stores. Each coordinator transition and its outbox event commit in one DO storage transaction (`transactionSync`). `drainOutbox()` mirrors events into D1 with `INSERT OR IGNORE` on the event id and acknowledges them afterwards. A failed mirror leaves events pending. It cannot cause a second mutation, because execution state is read only from the coordinator. `verifyLedger()` rebuilds action states from the event ledger alone.

## Mutation lifecycle (spec §16)

`PROPOSED → REJECTED | SHADOWED | APPROVAL_REQUIRED | APPROVED → PREPARING → EXECUTING → APPLIED → VERIFIED`, with `PARTIALLY_APPLIED`, `UNKNOWN_OUTCOME → RECONCILING`, `COMPENSATION_REQUIRED → COMPENSATED`, `EXPIRED`, `FAILED`. The transition table is in `src/coordinator/states.ts` and is enforced on every write.

Before execution: mode and lock are re-read. Reservations are persisted for every touched resource (budget, campaign, ad), and any existing reservation or suspension refuses the action. Live provider state is re-read and compared with the expected before-state; a mismatch is recorded as an external change and the action is rejected. Policy is re-evaluated with fresh spend, capacity and maturity. Each operation is then sent with a stable idempotency key and verified by reading back before the next one (a transfer reduces first). The lock is re-checked before each send.

Ambiguous outcomes become `UNKNOWN_OUTCOME` and keep their reservations. Reconciliation only reads, never re-sends. A partial transfer is never restored automatically. Compensation runs only if the provider still shows exactly the after-state this app applied. Resuming a paused campaign is never a "rollback": it is a new spend decision.

## Architecture decision records

| ADR | Decision | Why |
|---|---|---|
| 0001 | New app folder `growth/` in the existing `dosbuhos-ops` monorepo, its own Worker. `hub/` is not modified | Repo convention ("each new app as its own folder"); don't disturb existing apps |
| 0002 | Identity = the existing Hub (Google sign-in → HMAC-signed `X-DB-User` over a service binding). `HUB_SECRET` required outside dev; production has `workers_dev: false`, `preview_urls: false` and no route of its own | An equivalent, already-deployed identity boundary; no unprotected alternate hostname. Cloudflare Access can be added in front of the Hub without code changes |
| 0003 | Demo and real data live in separate D1 databases; `business_settings.data_kind` must equal the Worker's `DATA_KIND` or the Worker refuses to run; synthetic data refuses to load into a non-demo DB | Synthetic and real data can never mix (AC 1) |
| 0004 | Phase 1 Google Ads reads come from a Google Ads Script feed, not the API | Works today without Google Ads API access approval; the API adapter is a typed contract that throws `not_enabled` |
| 0005 | One package (not npm workspaces); folders mirror the suggested `apps/` and `packages/` split under `src/` and `web/` | Matches the monorepo's one-folder-per-app deploys (Workers Builds root directory) while keeping the logical boundaries |
| 0006 | TypeScript Worker + Hono + Zod; React + Vite dashboard; TradingView Lightweight Charts (Apache-2.0, attribution logo kept) for the hero chart, hand-drawn SVG sparklines | The spec's preferred stack; a maintained financial chart library with a compatible license |
| 0007 | One cron (`*/15 * * * *`, UTC) dispatches every job by *logical run key*; reviews run as Workflow instances whose id is the run key | One canonical scheduler; duplicate firings and retries run once; local times computed with explicit zones |
| 0008 | Coordinator logic is storage-agnostic (`SqlStore`), tested on Node's built-in SQLite; the DO wraps it on its SQLite storage | Failure-mode tests run fast and deterministically without a Workers runtime |
| 0009 | Rezdy removed from scope (owner, 2026-11-14); OpenTable CSV export is the booking source for the restaurant and experiences | OpenTable offers no reservation API to restaurants |
| 0010 | Default model `claude-opus-5-5`, configurable via `ANTHROPIC_MODEL`; server-side refusal fallback (`fallbacks: "default"`); tools use `tool_choice: auto` with `strict` schemas | Current model guidance; forced tool choice is not supported on this model |

Prompt version: `PROMPT_VERSION` in `src/ai/claude.ts`. Schema version: `migrations/` plus `COORDINATOR_SCHEMA` in `src/coordinator/sql.ts`.
