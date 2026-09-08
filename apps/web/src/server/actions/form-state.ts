import { DomainError } from '@protocols/domain';
import { ZodError } from 'zod';

/** Shape returned by every server action to its form via useActionState. */
export interface FormState {
  ok: boolean;
  message: string | null;
  /** Field-level messages, keyed by form field name. */
  fieldErrors: Record<string, string>;
  /** Extra data the form needs, e.g. the id of a blocking duplicate report. */
  data?: Record<string, unknown>;
}

export const emptyFormState: FormState = { ok: false, message: null, fieldErrors: {} };

export function successState(message: string, data?: Record<string, unknown>): FormState {
  return { ok: true, message, fieldErrors: {}, data };
}

export function errorState(message: string, fieldErrors: Record<string, string> = {}): FormState {
  return { ok: false, message, fieldErrors };
}

/**
 * Turns thrown errors into a form state.
 *
 * Unknown errors are logged server-side and reported to the user as a generic
 * failure: database messages can contain report text and email addresses, and
 * must not be echoed into the browser.
 */
export function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || 'form';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: 'Please correct the highlighted fields.', fieldErrors };
  }

  if (err instanceof DomainError) {
    return {
      ok: false,
      message: err.message,
      fieldErrors: {},
      data: err.details,
    };
  }

  console.error('[action] unexpected error', err);
  return errorState('Something went wrong. Please try again, and tell the lab admin if it keeps happening.');
}
