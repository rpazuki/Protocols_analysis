'use client';

import { useActionState } from 'react';
import { acceptAgreementAction } from '../server/actions/agreement.ts';
import { emptyFormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

export function AgreementForm({ returnTo, email }: { returnTo: string; email: string }) {
  const [state, formAction] = useActionState(acceptAgreementAction, emptyFormState);

  return (
    <form action={formAction} className="card">
      <input type="hidden" name="returnTo" value={returnTo} />
      <FormMessage state={state} />

      <div className="checkbox-row field">
        <input id="accept" name="accept" type="checkbox" value="yes" />
        <label htmlFor="accept">
          I have read the above and understand that my Imperial email address ({email}) is stored as
          my username and is attached to my reports, to audit records, and to lab data exports.
        </label>
      </div>
      {state.fieldErrors.accept ? <p className="error">{state.fieldErrors.accept}</p> : null}

      <div className="row row--end">
        <SubmitButton pendingLabel="Recording...">Acknowledge and continue</SubmitButton>
      </div>
    </form>
  );
}
