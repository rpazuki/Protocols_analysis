'use client';

import { useFormStatus } from 'react-dom';

/** Disables itself while the enclosing server action is in flight, so a slow save cannot be double-submitted. */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn btn--primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? (pendingLabel ?? 'Working...') : children}
    </button>
  );
}
