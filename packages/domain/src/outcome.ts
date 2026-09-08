/**
 * Report outcome. Fixed two-value enum per the product overview:
 * "Outcome: success or failure."
 */
export const OUTCOMES = ['success', 'failure'] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  success: 'Success',
  failure: 'Failure',
};
