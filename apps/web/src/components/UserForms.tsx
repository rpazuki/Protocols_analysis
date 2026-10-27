'use client';
import { useActionState, useState, useEffect } from 'react';
import { manageUserAction, changePasswordAction } from '../server/actions/users.ts';
import { emptyFormState, type FormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

function AccountResult({ state }: { state: FormState }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const password = typeof state.data?.temporaryPassword === 'string' ? state.data.temporaryPassword : null;
  return <><FormMessage state={state} />
    {password && hidden !== password ? <div role="status" className="notice notice--warning">
      <strong>Temporary password: </strong><code style={{ overflowWrap: 'anywhere' }}>{password}</code>
      <p>Copy it now and deliver it securely. The user must change it when signing in.</p>
      <button type="button" className="btn btn--sm" onClick={() => setHidden(password)}>Hide password</button>
    </div> : null}</>;
}

export function CreateUserForm() {
  const [state, action] = useActionState(manageUserAction, emptyFormState);
  return <form action={action} className="card" style={{ maxWidth: '36rem' }}>
    <h2>Create a local user</h2><AccountResult state={state} />
    <input type="hidden" name="operation" value="create" />
    <div className="field"><label htmlFor="new-user-email">Email address</label>
      <input id="new-user-email" name="email" type="email" maxLength={320} required autoComplete="off" /></div>
    <div className="field"><label htmlFor="new-user-role">Role</label>
      <select id="new-user-role" name="role" defaultValue="researcher"><option value="researcher">Researcher</option><option value="admin">Administrator</option></select></div>
    <p className="hint">A temporary password is generated. Creating an account does not send an email.</p>
    <SubmitButton pendingLabel="Creating...">Create user</SubmitButton>
  </form>;
}

export function UserOperationForm({ email, operation, label, disabled = false }: {
  email: string; operation: string; label: string; disabled?: boolean;
}) {
  const [state, action] = useActionState(manageUserAction, emptyFormState);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { if (state.ok) setConfirmed(false); }, [state]);
  return <form action={action} style={{ marginBottom: '.75rem' }}>
    <input type="hidden" name="email" value={email} /><input type="hidden" name="operation" value={operation} />
    {confirmed ? <><p>Confirm {label.toLowerCase()} for {email}?</p>
      <SubmitButton className="btn btn--sm" pendingLabel="Saving...">Confirm {label.toLowerCase()}</SubmitButton>{' '}
      <button className="btn btn--sm" type="button" onClick={() => setConfirmed(false)}>Cancel</button></>
      : <button className="btn btn--sm" type="button" disabled={disabled} onClick={() => setConfirmed(true)}>{label}</button>}
    <AccountResult state={state} />
  </form>;
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, emptyFormState);
  return <form action={action} className="card" style={{ maxWidth: '36rem' }}>
    <FormMessage state={state} />
    <div className="field"><label htmlFor="current-password">Current or temporary password</label>
      <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" maxLength={1024} required /></div>
    <div className="field"><label htmlFor="new-password">New password</label>
      <input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required aria-describedby="password-hint" /></div>
    <div className="field"><label htmlFor="confirmation">Confirm new password</label>
      <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required aria-describedby="password-hint" /></div>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
      <span id="password-hint" className="hint">Use 12–1024 characters, different from your current password.</span>
      <SubmitButton pendingLabel="Changing...">Change password</SubmitButton>
    </div>
  </form>;
}
