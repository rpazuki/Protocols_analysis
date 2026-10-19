'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { Outcome, ProtocolType } from '@protocols/domain';
import { emptyFormState, type FormState } from '../server/actions/form-state.ts';
import { SubmitButton } from './SubmitButton.tsx';
import { Notice } from './Notice.tsx';

export interface ReportFormValues {
  reportDate: string;
  protocolTypeId: string;
  protocolName: string;
  descriptionText: string;
  outcome: Outcome | '';
  outcomeHypothesis: string;
}

/**
 * The single report form, shared by new / copy-from-existing / edit.
 *
 * The researcher email is rendered as a disabled input and is NOT submitted:
 * the server derives it from the session. Submitting it would create a field
 * a caller could tamper with.
 */
export function ReportForm({
  action,
  values,
  protocolTypes,
  researcherEmail,
  submitLabel,
  reportId,
  copiedFromReportId,
  cancelHref,
  retiredTypeLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: ReportFormValues;
  protocolTypes: ProtocolType[];
  researcherEmail: string;
  submitLabel: string;
  reportId?: string;
  copiedFromReportId?: string;
  cancelHref: string;
  /** Label of a now-disabled type this report used, so the user is told why it is missing. */
  retiredTypeLabel?: string | null;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const duplicateId = state.data?.existingReportId as string | undefined;

  return (
    <form action={formAction} className="card">
      {reportId ? <input type="hidden" name="id" value={reportId} /> : null}
      {copiedFromReportId ? (
        <input type="hidden" name="copiedFromReportId" value={copiedFromReportId} />
      ) : null}

      {state.message ? (
        <Notice kind={state.ok ? 'success' : 'error'}>
          {state.message}
          {duplicateId && duplicateId !== 'unknown' ? (
            <>
              {' '}
              <Link href={`/reports/${duplicateId}`}>Open the existing report</Link>.
            </>
          ) : null}
        </Notice>
      ) : null}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="reportDate">Report date</label>
          <input
            id="reportDate"
            name="reportDate"
            type="date"
            defaultValue={values.reportDate}
            required
            aria-invalid={state.fieldErrors.reportDate ? 'true' : undefined}
            aria-describedby="reportDate-hint"
          />
          <span className="hint" id="reportDate-hint">
            Defaults to today. Change it if you are recording an earlier day.
          </span>
          {state.fieldErrors.reportDate ? (
            <span className="error">{state.fieldErrors.reportDate}</span>
          ) : null}
        </div>

        <div className="field field--readonly">
          <label htmlFor="researcherEmailDisplay">Researcher</label>
          <input
            id="researcherEmailDisplay"
            type="text"
            value={researcherEmail}
            disabled
            aria-describedby="researcherEmail-hint"
          />
          <span className="hint" id="researcherEmail-hint">
            Taken from your sign-in and cannot be changed.
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="protocolTypeId">Protocol type</label>
        <select
          id="protocolTypeId"
          name="protocolTypeId"
          defaultValue={values.protocolTypeId}
          required
          aria-invalid={state.fieldErrors.protocolTypeId ? 'true' : undefined}
        >
          <option value="">Choose a protocol type...</option>
          {protocolTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        {retiredTypeLabel ? (
          <span className="hint">
            This report was saved as &ldquo;{retiredTypeLabel}&rdquo;, which an admin has since disabled.
            Choose a current type to save your changes.
          </span>
        ) : null}
        {state.fieldErrors.protocolTypeId ? (
          <span className="error">{state.fieldErrors.protocolTypeId}</span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="protocolName">Protocol name</label>
        <input
          id="protocolName"
          name="protocolName"
          type="text"
          defaultValue={values.protocolName}
          maxLength={200}
          required
          aria-invalid={state.fieldErrors.protocolName ? 'true' : undefined}
          aria-describedby="protocolName-hint"
        />
        <span className="hint" id="protocolName-hint">
          A short handle for this variation, e.g. &ldquo;Lipofectamine ratio 1:2&rdquo;.
        </span>
        {state.fieldErrors.protocolName ? (
          <span className="error">{state.fieldErrors.protocolName}</span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="descriptionText">Protocol description</label>
        <textarea
          id="descriptionText"
          name="descriptionText"
          className="tall"
          defaultValue={values.descriptionText}
          required
          aria-invalid={state.fieldErrors.descriptionText ? 'true' : undefined}
          aria-describedby="descriptionText-hint"
        />
        <span className="hint" id="descriptionText-hint">
          Describe the wet-lab procedure, what you changed, and how you ran it. Length is unrestricted.
        </span>
        {state.fieldErrors.descriptionText ? (
          <span className="error">{state.fieldErrors.descriptionText}</span>
        ) : null}
      </div>

      <fieldset className="field">
        <legend className="label">Outcome</legend>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="outcome"
              value="success"
              defaultChecked={values.outcome === 'success'}
              required
            />
            Success
          </label>
          <label>
            <input
              type="radio"
              name="outcome"
              value="failure"
              defaultChecked={values.outcome === 'failure'}
              required
            />
            Failure
          </label>
        </div>
        {state.fieldErrors.outcome ? <span className="error">{state.fieldErrors.outcome}</span> : null}
      </fieldset>

      <div className="field">
        <label htmlFor="outcomeHypothesis">Outcome hypothesis (optional)</label>
        <textarea
          id="outcomeHypothesis"
          name="outcomeHypothesis"
          defaultValue={values.outcomeHypothesis}
          aria-describedby="outcomeHypothesis-hint"
        />
        <span className="hint" id="outcomeHypothesis-hint">
          Explain what you think went right or wrong in the experiment, and why.
        </span>
      </div>

      <div className="row row--end">
        <Link className="btn" href={cancelHref}>
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving...">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
