import { z } from 'zod';
import { DomainError } from './errors.ts';
import { normalizeEmail } from './normalize.ts';

/**
 * Researcher access denylist.
 *
 * Imperial SSO authenticates the whole institution, which is wider than lab
 * membership. The lab's decision (docs/planning/review-action-items.md) was to
 * keep sign-in broad and block named individuals, rather than to maintain an
 * allowlist that would gate every new lab member on an admin action.
 *
 * A denied user is refused after authentication succeeds: identity is proven,
 * authorization is refused. That ordering matters, because the denial has to
 * be recorded against a known email address.
 */

export interface DenylistEntry {
  email: string;
  reason: string | null;
  addedAt: string;
  addedBy: string;
  removedAt: string | null;
  removedBy: string | null;
  /**
   * True while the address is listed in ACCESS_DENYLIST_EMAILS. Such entries
   * are re-asserted on every start and cannot be lifted from the admin page.
   * An address dropped from config keeps its block but becomes an ordinary
   * in-app entry.
   */
  fromConfig: boolean;
}

export const DENYLIST_REASON_MAX = 500;

export const denylistAddSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.string().email('Enter a valid email address.').max(320)),
  reason: z
    .string()
    .max(DENYLIST_REASON_MAX, `Reason must be ${DENYLIST_REASON_MAX} characters or fewer.`)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null),
});

export type DenylistAddInput = z.infer<typeof denylistAddSchema>;

export const denylistRemoveSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.string().email('Enter a valid email address.').max(320)),
});

/**
 * Refuses to deny an admin.
 *
 * Denying an admin would be an indirect way to strip admin access while
 * leaving them on the allowlist, which makes the two lists disagree about who
 * has access. Remove them as an admin first, so the change is visible and
 * audited as what it is.
 */
export function assertDeniable(params: { target: string; actor: string; activeAdmins: string[] }): void {
  const target = normalizeEmail(params.target);

  if (target === normalizeEmail(params.actor)) {
    throw new DomainError('forbidden', 'You cannot block your own access.', { target });
  }
  if (params.activeAdmins.map(normalizeEmail).includes(target)) {
    throw new DomainError(
      'forbidden',
      'That address is a lab admin. Remove their admin access first, then block them.',
      { target },
    );
  }
}

export function isDenied(email: string, activeDenials: string[]): boolean {
  const normalized = normalizeEmail(email);
  return activeDenials.some((d) => normalizeEmail(d) === normalized);
}
