'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Error boundary. The message from the server is not rendered: it can contain
 * database detail and report text. The digest is shown so a researcher can
 * quote it to the lab admin, who can find the matching server log line.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <div className="page-header">
        <h1>Something went wrong</h1>
      </div>
      <div className="notice notice--error" role="alert">
        <p>
          The page could not be loaded. Your data has not been changed. Try again, and tell the lab
          admin if it keeps happening.
        </p>
        {error.digest ? (
          <p>
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
      <div className="row">
        <button className="btn btn--primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn" href="/reports">
          Back to my reports
        </Link>
      </div>
    </>
  );
}
