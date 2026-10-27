'use server';

import { revalidatePath } from 'next/cache';
import { adminsRepo, denylistRepo, withTransaction } from '@protocols/db';
import { assertDeniable, denylistAddSchema, denylistRemoveSchema } from '@protocols/domain';
import { config } from '../config.ts';
import { auditRequired } from '../audit.ts';
import { requireAdminForAction } from '../auth/principal.ts';
import { successState, toFormState, type FormState } from './form-state.ts';

/**
 * Researcher access denylist management.
 *
 * Blocking someone is an access-control decision about a named person, so each
 * change commits with its audit event and records who made it.
 */

export async function denyAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const principal = await requireAdminForAction();
    const { email, reason } = denylistAddSchema.parse({
      email: String(formData.get('email') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    });

    const entry = await withTransaction(async (client) => {
      // Read the admin list inside the transaction so the guard cannot be
      // raced by a concurrent admin removal.
      if (config.adapterId === 'local') await client.query('SELECT pg_advisory_xact_lock(7281946501)');
      const activeAdmins = await adminsRepo.listActiveAdminEmails(client);
      assertDeniable({ target: email, actor: principal.email, activeAdmins });

      const denied = await denylistRepo.denyAccess(email, reason, principal.email, client);
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'access.deny',
          targetType: 'researcher_denylist',
          targetId: denied.email,
          metadata: { email: denied.email, hasReason: Boolean(denied.reason) },
        },
        client,
      );
      return denied;
    });

    revalidatePath('/admin/access');
    return successState(
      `${entry.email} can no longer use this app. Their existing reports are untouched.`,
    );
  } catch (err) {
    return toFormState(err);
  }
}

export async function restoreAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const principal = await requireAdminForAction();
    const { email } = denylistRemoveSchema.parse({ email: String(formData.get('email') ?? '') });

    const entry = await withTransaction(async (client) => {
      const restored = await denylistRepo.restoreAccess(email, principal.email, client);
      if (!restored) return null;

      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'access.restore',
          targetType: 'researcher_denylist',
          targetId: restored.email,
          metadata: { email: restored.email },
        },
        client,
      );
      return restored;
    });

    revalidatePath('/admin/access');
    return entry
      ? successState(`${entry.email} can use this app again.`)
      : successState('That address was not blocked.');
  } catch (err) {
    return toFormState(err);
  }
}
