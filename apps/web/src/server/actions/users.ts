'use server';

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertAllowedDomain } from '@protocols/auth-core';
import { adminsRepo, localAuthRepo, withTransaction } from '@protocols/db';
import { config } from '../config.ts';
import { requireAdminForAction } from '../auth/principal.ts';
import { readSession, createSession } from '../auth/session.ts';
import { appUrl } from '../urls.ts';
import { errorState, successState, type FormState } from './form-state.ts';

// Only static application/function errors are shown. Never log DB error details,
// bound values, hashes, passwords, or a FormData object.
const safeErrors = new Set([
  'An active administrator session is required.', 'Supply a valid email address.',
  'This email is not currently an administrator.',
  'An account already exists for this email.', 'No local account exists for this email.',
  'This email is blocked. Restore access before creating an account.',
  'This email is blocked. Restore access before reactivating the account.',
  'Use Change password for your own account. You cannot disable yourself.',
  'This administrator is protected by deployment configuration.',
  'The last active local administrator is protected.',
  'Activate this account and restore its access before making it an administrator.',
  'Your session is no longer valid. Sign in again.',
  'The current password is not valid. Sign in again if your password was reset.',
  'Choose a new password different from the current password.',
]);
function accountError(error: unknown): FormState {
  if (error instanceof z.ZodError) return errorState('Check the email, operation and password fields.');
  if (error instanceof Error && safeErrors.has(error.message)) return errorState(error.message);
  console.error('[account] operation refused or failed');
  return errorState('The account change could not be completed. Refresh the page and try again.');
}

const userInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  operation: z.enum(['create','reset','disable','reactivate','promote','demote']),
  role: z.enum(['researcher','admin']).default('researcher'),
});

export async function manageUserAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    if (config.adapterId !== 'local') return errorState('Local accounts can only be managed in local login mode.');
    const principal = await requireAdminForAction();
    const session = await readSession();
    if (!session?.credentialVersion || session.mustChangePassword) return errorState('Sign in again first.');
    const input = userInput.parse({ email: String(form.get('email') ?? ''),
      operation: form.get('operation'), role: form.get('role') ?? 'researcher' });
    if (input.operation === 'create') {
      try { assertAllowedDomain(input.email, config.allowedEmailDomains); }
      catch { return errorState(`Use an approved email domain: ${config.allowedEmailDomains.join(', ')}.`); }
    }
    const password = ['create','reset'].includes(input.operation) ? randomBytes(18).toString('base64url') : undefined;
    await withTransaction(async client => {
      await localAuthRepo.manageAccount(principal.email, session.credentialVersion!, input.email, input.operation, password, client);
      if (input.operation === 'create') {
        if (input.role === 'admin') await localAuthRepo.manageAccount(principal.email, session.credentialVersion!, input.email, 'promote', undefined, client);
        else if (await adminsRepo.isActiveAdmin(input.email, client)) {
          await localAuthRepo.manageAccount(principal.email, session.credentialVersion!, input.email, 'demote', undefined, client);
        }
      }
    });
    revalidatePath('/admin/users');
    revalidatePath('/admin/admins');
    return successState(`${input.email}: ${input.operation} completed.`, password ? { temporaryPassword: password } : undefined);
  } catch (error) { return accountError(error); }
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  let version: number;
  let email: string;
  try {
    if (config.adapterId !== 'local') return errorState('Passwords are managed by your SSO provider.');
    const session = await readSession();
    if (!session?.credentialVersion) return errorState('Your session has expired. Sign in again.');
    const input = z.object({ currentPassword: z.string().min(1).max(1024),
      newPassword: z.string().min(12).max(1024), confirmation: z.string().max(1024) }).parse({
      currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword'), confirmation: form.get('confirmation'),
    });
    if (input.newPassword !== input.confirmation) return errorState('The new passwords do not match.');
    version = await localAuthRepo.changePassword(session.email,session.credentialVersion,input.currentPassword,input.newPassword);
    email = session.email;
    await createSession({ email, credentialVersion: version, subject: `local:${email}`, issuer: 'local-password' });
  } catch (error) {
    if (error instanceof z.ZodError) return errorState('Complete all password fields and use 12–1024 characters for the new password.');
    return accountError(error);
  }
  redirect(appUrl('/reports'));
}
