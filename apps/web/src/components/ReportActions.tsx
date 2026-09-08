'use client';

import { useActionState } from 'react';
import {
  permanentlyDeleteReportAction,
  recycleReportAction,
  restoreReportAction,
} from '../server/actions/reports.ts';
import { emptyFormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

export function RecycleButton({ reportId }: { reportId: string }) {
  const [state, formAction] = useActionState(recycleReportAction, emptyFormState);
  return (
    <>
      <FormMessage state={state} />
      <form action={formAction}>
        <input type="hidden" name="id" value={reportId} />
        <SubmitButton className="btn btn--danger" pendingLabel="Moving...">
          Move to recycle bin
        </SubmitButton>
      </form>
    </>
  );
}

export function RestoreButton({ reportId, disabled }: { reportId: string; disabled?: boolean }) {
  const [state, formAction] = useActionState(restoreReportAction, emptyFormState);
  if (disabled) return null;
  return (
    <>
      <FormMessage state={state} />
      <form action={formAction}>
        <input type="hidden" name="id" value={reportId} />
        <SubmitButton className="btn" pendingLabel="Restoring...">
          Restore
        </SubmitButton>
      </form>
    </>
  );
}

/**
 * Permanent delete requires typing DELETE. There is no undo: the report text
 * is removed from the database and only a tombstone and an audit event remain.
 */
export function PermanentDeleteForm({ reportId }: { reportId: string }) {
  const [state, formAction] = useActionState(permanentlyDeleteReportAction, emptyFormState);

  return (
    <form action={formAction} className="card">
      <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>Permanently delete</h3>
      <p className="hint">
        This removes the report text from the database. It cannot be undone. A record that the
        deletion happened is kept for accountability.
      </p>

      <FormMessage state={state} />

      <input type="hidden" name="id" value={reportId} />
      <div className="field">
        <label htmlFor={`confirm-${reportId}`}>Type DELETE to confirm</label>
        <input
          id={`confirm-${reportId}`}
          name="confirm"
          type="text"
          autoComplete="off"
          placeholder="DELETE"
          aria-invalid={state.fieldErrors.confirm ? 'true' : undefined}
        />
        {state.fieldErrors.confirm ? <span className="error">{state.fieldErrors.confirm}</span> : null}
      </div>

      <SubmitButton className="btn btn--danger" pendingLabel="Deleting...">
        Permanently delete this report
      </SubmitButton>
    </form>
  );
}
