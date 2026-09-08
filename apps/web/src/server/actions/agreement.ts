'use server';

import { redirect } from 'next/navigation';
import { agreementsRepo, withTransaction } from '@protocols/db';
import { AGREEMENT_VERSION } from '@protocols/domain';
import { APP_VERSION } from '../config.ts';
import { auditRequired } from '../audit.ts';
import { requireSignedIn } from '../auth/principal.ts';
import { safeReturnTo } from '../auth/session.ts';
import { errorState, toFormState, type FormState } from './form-state.ts';
import { appPath } from '../../lib/paths.ts';

/**
 * Records first-access acceptance of the privacy and use agreement.
 *
 * `accepted_from` holds app/version metadata only - no IP address, no user
 * agent - so the acceptance record does not widen the personal-data footprint
 * beyond the email address the app already stores.
 */
export async function acceptAgreementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const returnTo = safeReturnTo(String(formData.get('returnTo') ?? ''), '/reports');
  try {
    const principal = await requireSignedIn();

    if (formData.get('accept') === null) {
      return errorState('You must tick the box to acknowledge the agreement before continuing.', {
        accept: 'Required.',
      });
    }

    await withTransaction(async (client) => {
      const acceptance = await agreementsRepo.recordAcceptance(
        principal.email,
        `app:${APP_VERSION};agreement:${AGREEMENT_VERSION}`,
        client,
      );
      await auditRequired(
        {
          actorEmail: principal.email,
          action: 'agreement.accept',
          targetType: 'user_agreement',
          targetId: acceptance.agreementVersion,
          metadata: { agreementVersion: acceptance.agreementVersion },
        },
        client,
      );
    });
  } catch (err) {
    return toFormState(err);
  }

  redirect(appPath(returnTo));
}
