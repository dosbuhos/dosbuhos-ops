# Measurement and controls

## Definitions (implemented in `src/domain/metrics.ts`, `src/domain/measurement.ts`, `src/read/facts.ts`)

| Term | Definition |
|---|---|
| Net revenue | Collected, paid sales minus refunds and pass-through charges, minus tax and tips when the source includes them. A refundable deposit is not revenue |
| Contribution before marketing | Net revenue − approved variable costs (percentage of revenue + per guest) − commission, but only when the source amount is not already net of commission. No approved assumption → *unknown* |
| Attributed contribution after ad spend | Contribution of ad-attributed bookings − ad spend for the same booking-date cohort. Not whole-business profit and not proven incremental |
| Revenue ROAS | Attributed net revenue ÷ ad spend |
| Contribution ROAS | Attributed contribution ÷ ad spend |
| Attributed marketing ROI | (Attributed contribution − spend) ÷ spend |
| Cost per completed visit / guest / confirmed booking | Spend ÷ attributed completed parties / attended guests / confirmed bookings, each a separate number |
| Occupancy | Reserved places ÷ sellable places in slots with known capacity; unknown slots are excluded from the denominator and counted separately. Products are never added together |

Zero spend or missing inputs produce `null` with a reason, never 0 or ∞. Aggregate ratios sum their numerators and denominators; they never average per-campaign ratios. Every metric carries its basis: observed, attributed, modeled or experimental.

**Attribution (Phase 1):** a booking counts as ad-attributed only when OpenTable's own *Source* field says Google paid search. Its acquisition date is the booking-creation date, because click dates aren't available. Bookings with no source are *unknown*; they are never matched to clicks by timestamp or party size.

**Expected vs realized:** a confirmed future booking is valued at attendance probability × contribution if attended. Attendance probability is the historical rate, from at least 30 settled bookings. Contribution if attended uses the quoted price, or else the average paid per guest from at least 30 matched visits. A matched payment replaces the model. The two are never added.

**Three date views:** acquisition cohort (booking-creation date), booking pipeline (creation date) and operations (service date). The hero chart says which one it shows. Cohorts younger than the product's maturation lag (restaurant 14 days, tours 21, configurable) are *provisional*: dashed and dimmed, and they block profitability-based scaling until the lag has been estimated from data.

## Controls

| Control | Effect | Needs the AI? |
|---|---|---|
| Stop AI changes | Model-originated actions are refused and pending approvals are withdrawn. **Ads keep running** | No |
| Pause managed ads | Protective pause of every approved campaign, with each result read back from the provider. Works under the emergency lock | No |
| Emergency lock | Refuses every growth write, approved ones included. Turning it off lands in PAUSED | No |
| Modes | DEMO (mock only), OBSERVE, SHADOW, LIMITED_AUTO, PAUSED, EMERGENCY_LOCK; the coordinator enforces them at execution | No |
| Go live | LIMITED_AUTO requires a complete policy (ceiling, its scope, return floor, approved campaigns, protective stop, baseline) and confirmation of the exact policy version | No |

## Policy checks (in order, all recorded on each proposal)

Emergency lock, AI stopped, mode, account binding, campaign allowlist and writable flag, single budget controller, unknown outcome or suspension on the resource, required financial settings, daily change limit, minimum hours between budget changes, rolling 7-day cumulative change (counting changes by anyone, from Google Ads change history), aggregate budget against baseline (shared budgets counted once), fresh spend, expected and worst-case month exposure against the ceiling, mature measurement, capacity in the campaign's booking horizon, contribution-return floor. The last check, whether the action type may run automatically, can only send a proposal to owner approval; it never authorizes anything by itself.

Spending model: up to 2× the average daily budget on any day, capped by 30.4× for the month (Google Ads Help 1704424, as summarized on 2026-11-14 and still to be re-verified). It also adds spend not yet reported at the highest observed hourly rate, and includes unmanaged campaigns. A budget is not a hard cap, and the app never claims it is.
