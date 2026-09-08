import { OUTCOME_LABELS, type Outcome } from '@protocols/domain';

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <span className={`badge badge--${outcome}`}>{OUTCOME_LABELS[outcome]}</span>;
}
