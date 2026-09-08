import type { FormState } from '../server/actions/form-state.ts';
import { Notice } from './Notice.tsx';

/** Renders the message half of a FormState. Field errors are rendered next to their inputs. */
export function FormMessage({ state, children }: { state: FormState; children?: React.ReactNode }) {
  if (!state.message) return null;
  return (
    <Notice kind={state.ok ? 'success' : 'error'}>
      {state.message}
      {children}
    </Notice>
  );
}
