'use client';

import { useActionState } from 'react';
import type { ProtocolType } from '@protocols/domain';
import {
  createProtocolTypeAction,
  updateProtocolTypeAction,
} from '../server/actions/protocol-types.ts';
import { emptyFormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { FormMessage } from './FormMessage.tsx';

export function CreateProtocolTypeForm() {
  const [state, formAction] = useActionState(createProtocolTypeAction, emptyFormState);

  return (
    <form action={formAction} className="card">
      <h2 style={{ marginTop: 0 }}>Add a protocol type</h2>
      <FormMessage state={state} />

      <div className="grid-2">
        <div className="field">
          <label htmlFor="new-label">Label</label>
          <input
            id="new-label"
            name="label"
            type="text"
            maxLength={120}
            required
            aria-invalid={state.fieldErrors.label ? 'true' : undefined}
          />
          {state.fieldErrors.label ? <span className="error">{state.fieldErrors.label}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="new-sort">Sort order</label>
          <input id="new-sort" name="sortOrder" type="number" min={0} defaultValue={100} />
          <span className="hint">Lower numbers appear first in the dropdown.</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="new-description">Description (optional)</label>
        <textarea id="new-description" name="description" style={{ minHeight: '4.5rem' }} />
      </div>

      <div className="checkbox-row field">
        <input id="new-active" name="active" type="checkbox" defaultChecked />
        <label htmlFor="new-active">Available for new reports</label>
      </div>

      <SubmitButton pendingLabel="Adding...">Add protocol type</SubmitButton>
    </form>
  );
}

/**
 * Inline edit row. Renaming does not touch existing reports, which keep the
 * label snapshot they were saved with.
 */
export function EditProtocolTypeCard({ type, reportCount }: { type: ProtocolType; reportCount: number }) {
  const [state, formAction] = useActionState(updateProtocolTypeAction, emptyFormState);

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>{type.label}</h3>
        {type.active ? null : <span className="badge badge--recycled">Disabled</span>}
      </div>
      <form action={formAction}>
          <input type="hidden" name="id" value={type.id} />
          <FormMessage state={state} />

          <div className="grid-3">
            <div className="field">
              <label htmlFor={`label-${type.id}`}>Label</label>
              <input
                id={`label-${type.id}`}
                name="label"
                type="text"
                defaultValue={type.label}
                maxLength={120}
                required
                aria-invalid={state.fieldErrors.label ? 'true' : undefined}
              />
              {state.fieldErrors.label ? (
                <span className="error">{state.fieldErrors.label}</span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor={`sort-${type.id}`}>Sort order</label>
              <input
                id={`sort-${type.id}`}
                name="sortOrder"
                type="number"
                min={0}
                defaultValue={type.sortOrder}
              />
            </div>

            <div className="field">
              <span className="label">Used by</span>
              <p style={{ margin: 0 }}>
                {reportCount} report{reportCount === 1 ? '' : 's'}
              </p>
              <span className="hint">
                Existing reports keep their saved label if you rename this type.
              </span>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`desc-${type.id}`}>Description</label>
            <textarea
              id={`desc-${type.id}`}
              name="description"
              defaultValue={type.description ?? ''}
              style={{ minHeight: '4rem' }}
            />
          </div>

          <div className="row">
            <div className="checkbox-row">
              <input
                id={`active-${type.id}`}
                name="active"
                type="checkbox"
                defaultChecked={type.active}
              />
              <label htmlFor={`active-${type.id}`}>Available for new reports</label>
            </div>
            <span className="spacer" />
            <SubmitButton className="btn" pendingLabel="Saving...">
              Save
            </SubmitButton>
          </div>
      </form>
    </div>
  );
}
