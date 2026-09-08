import Link from 'next/link';
import { requirePrincipal } from '../../server/auth/principal.ts';

/** Shown when a signed-in researcher opens an admin-only page. */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const principal = await requirePrincipal('/reports');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Lab admins only</h1>
          <p className="lede">
            You are signed in as {principal.email}, which is not on the admin allowlist.
          </p>
        </div>
      </div>

      <div className="notice notice--warning">
        <p>
          {params.from ? (
            <>
              <code>{params.from}</code> is an admin page.{' '}
            </>
          ) : null}
          Managing protocol types, viewing every researcher&rsquo;s reports, exporting lab data, and
          editing the admin list are reserved for lab admins. Ask a lab admin if you need one of
          these.
        </p>
      </div>

      <div className="row">
        <Link className="btn btn--primary" href="/reports">
          My reports
        </Link>
        <Link className="btn" href="/reports/new">
          New report
        </Link>
      </div>
    </>
  );
}
