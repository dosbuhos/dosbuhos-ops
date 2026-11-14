// Action lifecycle. Every transition is persisted with its outbox event in one coordinator transaction.
export const ACTION_STATES = [
  'PROPOSED', 'REJECTED', 'SHADOWED', 'APPROVAL_REQUIRED', 'APPROVED', 'EXPIRED', 'PREPARING', 'EXECUTING',
  'APPLIED', 'PARTIALLY_APPLIED', 'UNKNOWN_OUTCOME', 'RECONCILING', 'VERIFIED', 'COMPENSATION_REQUIRED', 'COMPENSATED', 'FAILED',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export const TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  PROPOSED: ['REJECTED', 'SHADOWED', 'APPROVAL_REQUIRED', 'APPROVED'],
  APPROVAL_REQUIRED: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['PREPARING', 'EXPIRED', 'REJECTED'],
  PREPARING: ['EXECUTING', 'REJECTED'],
  EXECUTING: ['APPLIED', 'PARTIALLY_APPLIED', 'UNKNOWN_OUTCOME', 'FAILED'],
  APPLIED: ['VERIFIED', 'RECONCILING'],
  PARTIALLY_APPLIED: ['RECONCILING', 'COMPENSATION_REQUIRED'],
  UNKNOWN_OUTCOME: ['RECONCILING'],
  RECONCILING: ['VERIFIED', 'FAILED', 'PARTIALLY_APPLIED', 'UNKNOWN_OUTCOME'],
  VERIFIED: ['COMPENSATION_REQUIRED'],
  COMPENSATION_REQUIRED: ['COMPENSATED', 'VERIFIED', 'PARTIALLY_APPLIED'],
  // terminal
  REJECTED: [], SHADOWED: [], EXPIRED: [], COMPENSATED: [], FAILED: [],
};

export const TERMINAL: ReadonlySet<ActionState> = new Set(['REJECTED', 'SHADOWED', 'EXPIRED', 'COMPENSATED', 'FAILED']);
/** States in which the action still holds its resource reservation (blocks conflicting changes). */
export const HOLDS_RESERVATION: ReadonlySet<ActionState> = new Set(['PREPARING', 'EXECUTING', 'APPLIED', 'PARTIALLY_APPLIED', 'UNKNOWN_OUTCOME', 'RECONCILING', 'COMPENSATION_REQUIRED']);

export class InvalidTransitionError extends Error {
  constructor(from: ActionState, to: ActionState) { super(`Invalid action transition ${from} → ${to}`); }
}
export function assertTransition(from: ActionState, to: ActionState): void {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
}
