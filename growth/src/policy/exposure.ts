// Conservative month-spend exposure. The local ledger cannot debit auction charges in real time and Google Ads can
// overdeliver an average daily budget, so every growth write is tested against a projection, not a hard cap.
//
// Platform behavior constants are configurable. Defaults follow Google Ads Help "About average daily budgets"
// (support.google.com/google-ads/answer/1704424) as summarized on 2026-11-14 — up to 2× the average daily budget on a
// single day, and a monthly charging limit of 30.4× the average daily budget. That page could not be fetched from the
// build session (network allowlist); re-verify before production (docs/integrations.md).

export interface PlatformSpendBehavior { maxDailyOverdeliveryFactor: number; monthlyChargeLimitFactor: number; source: string }
export const GOOGLE_ADS_DEFAULT_BEHAVIOR: PlatformSpendBehavior = {
  maxDailyOverdeliveryFactor: 2,
  monthlyChargeLimitFactor: 30.4,
  source: 'Google Ads Help 1704424 (search summary 2026-11-14; verify)',
};

export interface ExposureInput {
  monthToDateSpendMicros: number;       // all campaigns in the account, managed and unmanaged
  spendDataAgeMinutes: number;          // how old the newest spend reading is
  daysRemainingInMonth: number;         // including the rest of today, may be fractional
  managedDailyBudgetsMicros: number[];  // distinct budgets (shared budgets once), after the proposed change
  unmanagedDailyBudgetsMicros: number[];
  observedMaxHourlySpendMicros: number; // highest hourly spend seen recently (from the 15-minute poll)
  behavior: PlatformSpendBehavior;
}

export interface Exposure {
  expectedMonthMicros: number;   // MTD + unreported + budgets at face value for the rest of the month
  worstCaseMonthMicros: number;  // MTD + unreported + overdelivery, bounded by the monthly charging limit
  unreportedMicros: number;
  explanation: string[];
}

export function projectExposure(i: ExposureInput): Exposure {
  const daily = [...i.managedDailyBudgetsMicros, ...i.unmanagedDailyBudgetsMicros].reduce((a, b) => a + b, 0);
  const unreported = Math.round(i.observedMaxHourlySpendMicros * (i.spendDataAgeMinutes / 60));
  const days = Math.max(0, i.daysRemainingInMonth);
  const known = i.monthToDateSpendMicros + unreported;
  const expected = known + Math.round(daily * days);
  const overdelivered = known + Math.round(daily * i.behavior.maxDailyOverdeliveryFactor * days);
  const monthlyLimit = Math.round(daily * i.behavior.monthlyChargeLimitFactor);
  const worst = Math.max(expected, Math.min(overdelivered, Math.max(known, monthlyLimit)));
  return {
    expectedMonthMicros: expected,
    worstCaseMonthMicros: worst,
    unreportedMicros: unreported,
    explanation: [
      `Month-to-date spend plus up to ${(i.spendDataAgeMinutes / 60).toFixed(1)} h not yet reported at the highest observed hourly rate`,
      `Rest of month at face-value budgets: ${days.toFixed(1)} day(s)`,
      `Worst case: up to ${i.behavior.maxDailyOverdeliveryFactor}× daily budget per day, capped by ${i.behavior.monthlyChargeLimitFactor}× daily budget for the month (${i.behavior.source})`,
    ],
  };
}

export interface SpendState {
  readAt: number;                       // when the provider was read
  dataAsOf: number;                     // newest time the provider's numbers cover
  monthToDateMicros: number;
  observedMaxHourlyMicros: number;
  unmanagedDailyBudgetsMicros: number[];
}
