'use client';

import { useActionState } from 'react';
import { denyAccessAction, restoreAccessAction } from '../server/actions/denylist.ts';
import { emptyFormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

export function DenyAccessForm() {
  const [state, formAction] = useActionState(denyAccessAction, emptyFormState);

  return (
    <form action={formAction} className="card">
      <h2 style={{ marginTop: 0 }}>Block an address</h2>
      <p className="hint">
        Imperial sign-in covers the whole institution, so this is how someone who should not be
        using the lab record is kept out. Blocking takes effect on their next request. Their
        existing reports are left exactly as they are.
      </p>

      <FormMessage state={state} />

      <div className="field">
        <label htmlFor="deny-email">Imperial email address</label>
        <input
          id="deny-email"
          name="email"
          type="email"
          required
          placeholder="name@ic.ac.uk"
          aria-invalid={state.fieldErrors.email ? 'true' : undefined}
        />
        {state.fieldErrors.email ? <span className="error">{state.fieldErrors.email}</span> : null}
      </div>

      <div className="field">
        <label htmlFor="deny-reason">Reason (optional)</label>
        <input id="deny-reason" name="reason" type="text" maxLength={500} />
        <span className="hint">
          Visible to lab admins only, so that whoever reviews this later knows why. The blocked
          person is not shown it.
        </span>
      </div>

      <SubmitButton className="btn btn--danger" pendingLabel="Blocking...">
        Block access
      </SubmitButton>
    </form>
  );
}

export function RestoreAccessForm({ email }: { email: string }) {
  const [state, formAction] = useActionState(restoreAccessAction, emptyFormState);

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="email" value={email} />
        <SubmitButton className="btn btn--sm" pendingLabel="Restoring...">
          Restore access
        </SubmitButton>
      </form>
      {state.message ? (
        <div className="cell-secondary" style={{ color: state.ok ? 'var(--success)' : 'var(--danger)' }}>
          {state.message}
        </div>
      ) : null}
    </>
  );
}
