import { z } from 'zod';
import { normalizeEmail } from './normalize.ts';
import { DomainError } from './errors.ts';

export interface AdminAllowlistEntry {
  email: string;
  addedAt: string;
  addedBy: string;
  removedAt: string | null;
  removedBy: string | null;
  /** True for entries seeded from deployment config rather than the admin UI. */
  fromConfig: boolean;
}

export const adminEmailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.string().email('Enter a valid email address.').max(320));

export const adminAddSchema = z.object({ email: adminEmailSchema });
export const adminRemoveSchema = z.object({ email: adminEmailSchema });

/**
 * Guards the "cannot remove the last admin" rule. Config-sourced bootstrap
 * admins also cannot be removed through the UI: they come back on restart, so
 * removing them in the app would be a silent no-op. The documented VM recovery
 * path is to edit deployment config (docs/admin-ops/admin-management.md).
 */
export function assertRemovable(params: {
  target: string;
  actor: string;
  activeAdmins: string[];
  configAdmins: string[];
}): void {
  const target = normalizeEmail(params.target);
  const activeAdmins = params.activeAdmins.map(normalizeEmail);
  const configAdmins = params.configAdmins.map(normalizeEmail);

  if (!activeAdmins.includes(target)) {
    throw new DomainError('not_found', 'That email address is not currently an admin.', { target });
  }
  if (configAdmins.includes(target)) {
    throw new DomainError(
      'last_admin_protected',
      'This admin comes from deployment configuration and cannot be removed in the app. Change the bootstrap admin config on the server instead.',
      { target },
    );
  }
  if (activeAdmins.length <= 1) {
    throw new DomainError(
      'last_admin_protected',
      'Cannot remove the last remaining admin. Add another admin first.',
      { target },
    );
  }
}

export function isAdmin(email: string, activeAdmins: string[]): boolean {
  const normalized = normalizeEmail(email);
  return activeAdmins.some((a) => normalizeEmail(a) === normalized);
}
