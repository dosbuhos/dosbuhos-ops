// Shared runtime schemas (Zod). Used by the API, the coordinator, the AI adapter and the web app's types.
import { z } from 'zod';

export const MODES = ['DEMO', 'OBSERVE', 'SHADOW', 'LIMITED_AUTO', 'PAUSED', 'EMERGENCY_LOCK'] as const;
export const Mode = z.enum(MODES);
export type Mode = z.infer<typeof Mode>;

// Registered action classes. Anything not in this list cannot be proposed, authorized or executed.
export const ACTION_TYPES = [
  'campaign_budget_change',     // change one campaign budget (increase or decrease)
  'budget_reallocation',        // move budget between approved campaigns without raising the aggregate
  'pause_ad',                   // pause one clearly failing approved ad/creative
  'add_negative_keyword_exact', // add one exact-match negative keyword after conflict checks
  'pause_campaign',             // protective pause (also used by "Pause managed ads")
] as const;
export const ActionType = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionType>;

// The policy template from the spec. Financial fields start null and block production growth writes until set.
export const PolicyConfig = z.object({
  mode: Mode,
  reportingTimezone: z.string().min(1),
  reportingCurrency: z.enum(['MXN', 'USD']),
  monthlyAdSpendCeilingNative: z.number().int().positive().nullable(),     // whole units of account currency
  ceilingCoversWholeAccount: z.boolean().nullable(),                       // null = owner has not said
  experimentSpendAllowanceNative: z.number().int().nonnegative().nullable(),
  minimumAcceptableContributionReturn: z.number().nullable(),              // contribution ROAS floor, e.g. 1.5
  approvedCampaignIds: z.array(z.string().regex(/^\d+$/)).max(200),
  allowedAutomaticActions: z.array(ActionType),
  maxCampaignBudgetChangePctPer7Days: z.number().min(0).max(100),
  minHoursBetweenBudgetChanges: z.number().int().min(0),
  maxOptimizationMutationsPerDay: z.number().int().min(0),
  maxTotalBudgetBaselineIncreasePct: z.number().min(0).max(100),
  proposalExpiryHours: z.number().int().min(1).max(168),
  spendPollMinutes: z.number().int().min(5).max(120),
  spendReservePct: z.number().min(0).max(50),
  protectiveStopPctOfCeiling: z.number().min(0).max(100).nullable(),       // owner-calibrated; null = not set
  warningPctOfCeiling: z.number().min(0).max(100).nullable(),
  maxSpendDataAgeMinutes: z.number().int().min(5),
  requireFreshSpendForGrowthWrites: z.literal(true),
  requireMatureMeasurementForScaling: z.literal(true),
  allowNewCampaignActivation: z.boolean(),
  allowBidStrategyChanges: z.boolean(),
  allowPrimaryConversionChanges: z.boolean(),
  allowPriceOrDiscountChanges: z.boolean(),
  allowWebsitePublishing: z.boolean(),
  allowCustomerAudienceUploads: z.boolean(),
});
export type PolicyConfig = z.infer<typeof PolicyConfig>;

export const DEFAULT_POLICY: PolicyConfig = {
  mode: 'OBSERVE',
  reportingTimezone: 'America/Mexico_City',
  reportingCurrency: 'MXN',
  monthlyAdSpendCeilingNative: null,
  ceilingCoversWholeAccount: null,
  experimentSpendAllowanceNative: null,
  minimumAcceptableContributionReturn: null,
  approvedCampaignIds: [],
  allowedAutomaticActions: [],
  maxCampaignBudgetChangePctPer7Days: 10,
  minHoursBetweenBudgetChanges: 168,
  maxOptimizationMutationsPerDay: 2,
  maxTotalBudgetBaselineIncreasePct: 0,
  proposalExpiryHours: 24,
  spendPollMinutes: 15,
  spendReservePct: 10,
  protectiveStopPctOfCeiling: null,
  warningPctOfCeiling: null,
  maxSpendDataAgeMinutes: 90,
  requireFreshSpendForGrowthWrites: true,
  requireMatureMeasurementForScaling: true,
  allowNewCampaignActivation: false,
  allowBidStrategyChanges: false,
  allowPrimaryConversionChanges: false,
  allowPriceOrDiscountChanges: false,
  allowWebsitePublishing: false,
  allowCustomerAudienceUploads: false,
};

// ---------- what the model may submit ----------
// The model writes only these fields. Proposal ID, account binding, before/after values, expiry, policy decision and
// authorization are all supplied by the server.

const ResourceRef = z.string().regex(/^res_[a-z0-9]{3,40}$/, 'must be a server-issued resource reference');
const EvidenceRef = z.string().regex(/^ev_[a-z0-9_]{3,80}$/, 'must be a server-issued evidence reference');

export const ActionParameters = {
  campaign_budget_change: z.object({ changePct: z.number().min(-50).max(50).refine(v => v !== 0, 'change must not be zero') }).strict(),
  budget_reallocation: z.object({ toResourceRef: ResourceRef, amountPctOfSource: z.number().min(1).max(50) }).strict(),
  pause_ad: z.object({}).strict(),
  add_negative_keyword_exact: z.object({ text: z.string().min(1).max(80).regex(/^[\p{L}\p{N} '&.-]+$/u, 'plain words only') }).strict(),
  pause_campaign: z.object({}).strict(),
} as const satisfies Record<ActionType, z.ZodTypeAny>;

export const ModelProposal = z.object({
  schemaVersion: z.literal('1'),
  snapshotId: z.string().regex(/^snap_[a-z0-9]{6,40}$/),
  hypothesis: z.string().min(10).max(600),
  actionType: ActionType,
  resourceRef: ResourceRef,
  parameters: z.record(z.unknown()),
  evidenceRefs: z.array(EvidenceRef).min(1).max(12),
  expectedEffect: z.object({ metric: z.string().min(1).max(80), direction: z.enum(['increase', 'decrease', 'no_change']), range: z.tuple([z.number(), z.number()]).nullable() }).strict(),
  risks: z.array(z.string().min(3).max(300)).min(1).max(8),
  alternative: z.string().min(3).max(400),
  evaluationPlan: z.string().min(10).max(600),
  rollbackPlan: z.string().min(3).max(400),
}).strict();
export type ModelProposal = z.infer<typeof ModelProposal>;

// ---------- imports ----------

export const BookingCsvMapping = z.object({
  source: z.literal('opentable'),
  timezone: z.string().min(1),          // explicit — never inferred
  currency: z.enum(['MXN', 'USD']),
  columns: z.object({
    externalId: z.string(), createdAt: z.string(), serviceAt: z.string(), partySize: z.string(), status: z.string(),
    experience: z.string().optional(), quotedTotal: z.string().optional(), source: z.string().optional(),
  }),
});
export type BookingCsvMapping = z.infer<typeof BookingCsvMapping>;

export const ManualCapacityInput = z.object({
  slotId: z.string().max(80).optional(),
  product: z.enum(['restaurant_visit', 'tour_tasting', 'wine_order', 'private_event']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMin: z.number().int().min(0).max(1439),
  durationMin: z.number().int().min(15).max(720),
  bufferMin: z.number().int().min(0).max(240).default(0),
  state: z.enum(['open', 'closed', 'blocked']),
  maxGuests: z.number().int().min(0).max(1000).nullable(),
  requires: z.array(z.object({ resourceId: z.string().max(60), perGuest: z.number().min(0).max(10), perSlot: z.number().min(0).max(50) })).max(5).default([]),
  label: z.string().max(80).default(''),
});
export type ManualCapacityInput = z.infer<typeof ManualCapacityInput>;
