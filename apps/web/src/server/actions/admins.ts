'use server';

import { revalidatePath } from 'next/cache';
import { adminsRepo, withTransaction } from '@protocols/db';
import { adminAddSchema, adminRemoveSchema } from '@protocols/domain';
import { config } from '../config.ts';
import { auditRequired } from '../audit.ts';
import { requireAdminForAction } from '../auth/principal.ts';
import { errorState, successState, toFormState, type FormState } from './form-state.ts';

/**
 * Admin allowlist management.
 *
 * Each change and its audit event share one transaction: an admin grant that
 * committed without an audit row would be exactly the change nobody could
 * later account for. The last-admin and config-admin guards run inside that
 * same transaction against locked rows
 * (packages/db/src/repositories/admins.ts), so concurrent removals cannot race
 * past them.
 */

export async function addAdminAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const principal = await requireAdminForAction();
    const { email } = adminAddSchema.parse({ email: String(formData.get('email') ?? '') });

    if (config.allowedEmailDomains.length > 0) {
      const domain = email.split('@')[1] ?? '';
      const allowed = config.allowedEmailDomains.some(
        (d) => domain === d.toLowerCase().replace(/^@/, '') || domain.endsWith(`.${d.toLowerCase()}`),
      );
      if (!allowed) {
        return errorState(
          `Admin emails must be on an approved domain (${config.allowedEmailDomains.join(', ')}).`,
          { email: 'Domain is not approved.' },
        );
      }
    }

    const entry = await withTransaction(async (client) => {
      const added = await adminsRepo.addAdmin(email, principal.email, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'admin.add',
          targetType: 'admin_allowlist',
          targetId: added.email,
          metadata: { email: added.email },
        },
        client,
      );
      return added;
    });

    revalidatePath('/admin/admins');
    return successState(`${entry.email} can now administer this app.`);
  } catch (err) {
    return toFormState(err);
  }
}

export async function removeAdminAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const principal = await requireAdminForAction();
    const { email } = adminRemoveSchema.parse({ email: String(formData.get('email') ?? '') });

    const entry = await withTransaction(async (client) => {
      const removed = await adminsRepo.removeAdmin(email, principal.email, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'admin.remove',
          targetType: 'admin_allowlist',
          targetId: removed.email,
          metadata: { email: removed.email, selfRemoval: removed.email === principal.email },
        },
        client,
      );
      return removed;
    });

    revalidatePath('/admin/admins');
    return successState(
      entry.email === principal.email
        ? 'You removed your own admin access. You will lose admin pages on your next request.'
        : `${entry.email} is no longer an admin.`,
    );
  } catch (err) {
    return toFormState(err);
  }
}
