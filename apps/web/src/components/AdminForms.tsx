'use client';

import { useActionState } from 'react';
import { addAdminAction, removeAdminAction } from '../server/actions/admins.ts';
import { emptyFormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

export function AddAdminForm({ allowedDomains }: { allowedDomains: string[] }) {
  const [state, formAction] = useActionState(addAdminAction, emptyFormState);

  return (
    <form action={formAction} className="card">
      <h2 style={{ marginTop: 0 }}>Add an admin</h2>
      <FormMessage state={state} />

      <div className="field">
        <label htmlFor="admin-email">Imperial email address</label>
        <input
          id="admin-email"
          name="email"
          type="email"
          required
          placeholder="name@ic.ac.uk"
          aria-invalid={state.fieldErrors.email ? 'true' : undefined}
        />
        <span className="hint">
          {allowedDomains.length
            ? `Must be on an approved domain: ${allowedDomains.join(', ')}.`
            : 'The address is lowercased before it is saved.'}
        </span>
        {state.fieldErrors.email ? <span className="error">{state.fieldErrors.email}</span> : null}
      </div>

      <SubmitButton pendingLabel="Adding...">Add admin</SubmitButton>
    </form>
  );
}

export function RemoveAdminForm({ email, isSelf }: { email: string; isSelf: boolean }) {
  const [state, formAction] = useActionState(removeAdminAction, emptyFormState);

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="email" value={email} />
        <SubmitButton className="btn btn--danger btn--sm" pendingLabel="Removing...">
          {isSelf ? 'Remove my admin access' : 'Remove'}
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
