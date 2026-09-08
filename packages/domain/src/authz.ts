import { ForbiddenError } from './errors.ts';
import { normalizeEmail } from './normalize.ts';
import type { ProtocolReport } from './protocol-report.ts';

export type Role = 'researcher' | 'admin';

export interface Principal {
  email: string;
  role: Role;
  /** True when the session came from the mock adapter. Never true in production. */
  isMock: boolean;
}

export interface AuthzPolicy {
  /**
   * Open decision 3 in the plan. Default: researchers may restore their own
   * recycled reports. Set ALLOW_RESEARCHER_RESTORE=false to make restore
   * admin-only without a code change.
   */
  allowResearcherRestore: boolean;
  /**
   * Open decision 3 in the product overview. Default: researchers may
   * permanently delete their own recycled reports immediately.
   */
  allowResearcherPermanentDelete: boolean;
  /** Minimum days a report must sit in the recycle bin before permanent delete. 0 = no wait. */
  permanentDeleteWaitDays: number;
}

export const DEFAULT_AUTHZ_POLICY: AuthzPolicy = {
  allowResearcherRestore: true,
  allowResearcherPermanentDelete: true,
  permanentDeleteWaitDays: 0,
};

export function isOwner(principal: Principal, report: Pick<ProtocolReport, 'researcherEmail'>): boolean {
  return normalizeEmail(principal.email) === normalizeEmail(report.researcherEmail);
}

export function canViewReport(principal: Principal, report: Pick<ProtocolReport, 'researcherEmail'>): boolean {
  return principal.role === 'admin' || isOwner(principal, report);
}

/** Only the owner may edit report content. Admins can view, restore, and delete, but not rewrite someone else's record. */
export function canEditReport(
  principal: Principal,
  report: Pick<ProtocolReport, 'researcherEmail' | 'deletedAt'>,
): boolean {
  return report.deletedAt === null && isOwner(principal, report);
}

export function canRecycleReport(
  principal: Principal,
  report: Pick<ProtocolReport, 'researcherEmail' | 'deletedAt'>,
): boolean {
  if (report.deletedAt !== null) return false;
  return principal.role === 'admin' || isOwner(principal, report);
}

export function canRestoreReport(
  principal: Principal,
  report: Pick<ProtocolReport, 'researcherEmail' | 'deletedAt'>,
  policy: AuthzPolicy = DEFAULT_AUTHZ_POLICY,
): boolean {
  if (report.deletedAt === null) return false;
  if (principal.role === 'admin') return true;
  return policy.allowResearcherRestore && isOwner(principal, report);
}

export function canPermanentlyDeleteReport(
  principal: Principal,
  report: Pick<ProtocolReport, 'researcherEmail' | 'deletedAt'>,
  policy: AuthzPolicy = DEFAULT_AUTHZ_POLICY,
  now: Date = new Date(),
): boolean {
  if (report.deletedAt === null) return false;
  if (policy.permanentDeleteWaitDays > 0) {
    const elapsedDays = (now.getTime() - new Date(report.deletedAt).getTime()) / 86_400_000;
    if (elapsedDays < policy.permanentDeleteWaitDays) return false;
  }
  if (principal.role === 'admin') return true;
  return policy.allowResearcherPermanentDelete && isOwner(principal, report);
}

export function canManageProtocolTypes(principal: Principal): boolean {
  return principal.role === 'admin';
}

export function canManageAdmins(principal: Principal): boolean {
  return principal.role === 'admin';
}

export function canExport(principal: Principal): boolean {
  return principal.role === 'admin';
}

export function canViewAllReports(principal: Principal): boolean {
  return principal.role === 'admin';
}

export function canViewAuditEvents(principal: Principal): boolean {
  return principal.role === 'admin';
}

/** Throwing wrappers, for use at the top of every server action. */
export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new ForbiddenError(message);
}
