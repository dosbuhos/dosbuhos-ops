# Acceptance evidence (spec §24)

`npm test` runs 65 tests (vitest) on 2026-11-14. "Local E2E" means it was exercised through `wrangler dev` with D1, the Durable Object, Workflows and R2 emulated locally. Nothing has run in a deployed environment yet.

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Demo cannot reach production mutation APIs; data never mixes | `coordinator.test.ts` "demo/dev can only hold the mock provider"; `assertDataKind` + `loadDemoData` refuse a mismatched DB | Tested |
| 2 | Replayed webhook/import doesn't duplicate | `connectors.test.ts` OpenTable duplicates; local E2E: re-import kept 2 bookings, feed replay kept 1 row per campaign-day | Tested + local E2E |
| 3 | Late cancellation / no-show / correction revises without duplicate value | `domain.test.ts` "out-of-order and replayed status events", "realized replaces expected"; import upsert only when newer at source | Tested |
| 4 | Missing conversion data → unknown, blocks profitability scaling | `domain.test.ts` null metrics; `evaluate.ts` `return_floor`, `mature_measurement`; demo shows a 3-day conversion gap as gaps | Tested |
| 5 | Cross-sell allocated once; platform claims don't inflate totals | `domain.test.ts` "allocates cross-sell once"; campaign view labels platform conversions as non-deduplicated | Tested |
| 6 | Currencies, micros, exclusions, zero denominators, aggregate ROAS | `domain.test.ts` money + metrics blocks | Tested |
| 7 | Shared guides/seats consistent; stale capacity doesn't justify scaling | `domain.test.ts` capacity block | Tested |
| 8 | OBSERVE/SHADOW/PAUSED/EMERGENCY_LOCK reject growth writes at the execution boundary | `coordinator.test.ts` "execution boundary by mode" (4 tests, provider call count 0) | Tested |
| 9 | Model output cannot change mode/limits/binding/policy or approve itself | `coordinator.test.ts` "model output cannot widen authority"; `submit_proposal` is the only model write tool | Tested |
| 10 | Concurrency and retries can't bypass limits/locks/shared budgets | `coordinator.test.ts` rolling limits (incl. others' changes), retry idempotency, concurrent execution, shared budget counted once, daily limit | Tested |
| 11 | Lost response → UNKNOWN_OUTCOME → reconcile before another mutation | `coordinator.test.ts` "a lost response…" | Tested |
| 12 | Partial transfer can't create an aggregate increase | `coordinator.test.ts` "reduces first…" | Tested |
| 13 | External edit invalidates preconditions and blocks blind compensation | `coordinator.test.ts` external edits block | Tested |
| 14 | OAuth refresh/revocation without exposing secrets | `connectors.test.ts` secrets block (sealing, connection binding, error classification). Per-connection refresh lock: not built (no OAuth connection yet) | Partly |
| 15 | Malicious search terms/CSV can't invoke actions or leak secrets | `connectors.test.ts` feed + import + hostile proposal; untrusted text is wrapped as data for the model | Tested |
| 16 | Projections include reporting delay and unmanaged campaigns; missing spend blocks growth | `domain.test.ts` exposure; `coordinator.test.ts` "re-checked against policy" (spend missing → rejected) | Tested |
| 17 | Stop-AI and pause-ads distinct, real outcomes, no LLM | `coordinator.test.ts` "Stop AI…", "pause managed ads works under EMERGENCY_LOCK…"; local E2E per-campaign results | Tested + local E2E |
| 18 | Reports available without Claude | `connectors.test.ts` reports block; local E2E daily and weekly Workflow published template reports with no key | Tested + local E2E |
| 19 | Local schedules once per logical day/week, UTC/DST | `domain.test.ts` schedules; local E2E: two cron firings, one run per key | Tested + local E2E |
| 20 | Dashboard shows declines, provisional periods, nulls, gaps on Android | Pixel 7 screenshots, no horizontal overflow on all 8 views; declines shown in red with ▼; provisional dashed/dimmed | Manually checked (no automated browser test yet) |
| 21 | Restore stays locked until reconciliation | `coordinator.test.ts` "restored storage stays locked…" | Tested |
| 22 | No unprotected hostname; forged requests/webhooks can't write | `connectors.test.ts` identity boundary; `workers_dev:false`, `preview_urls:false` in production; local E2E: forged identity, missing header and cross-site writes refused | Tested + local E2E |

Not yet evidenced: Google Ads API reads/writes (blocked), the Claude review against the live API (no key in this environment), production smoke tests (not deployed).
