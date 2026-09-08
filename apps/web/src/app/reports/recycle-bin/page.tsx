import Link from 'next/link';
import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { parseReportFilters } from '@protocols/domain';
import { config } from '../../../server/config.ts';
import { requirePrincipal } from '../../../server/auth/principal.ts';
import { ReportTable } from '../../../components/ReportTable.tsx';
import { Pagination } from '../../../components/Pagination.tsx';
import { Notice } from '../../../components/Notice.tsx';

/** A researcher's own recycled reports. Restore and permanent delete happen on the report page. */
export default async function RecycleBinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const principal = await requirePrincipal('/reports/recycle-bin');

  const filter = parseReportFilters(params, { forceState: 'recycled' });
  const [{ reports, total }] = await Promise.all([
    reportsRepo.listReports(filter, principal.email),
    protocolTypesRepo.listProtocolTypes({ includeInactive: true }),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>My recycle bin</h1>
          <p className="lede">
            Reports you have deleted. Open one to restore it or to delete it permanently.
          </p>
        </div>
        <Link className="btn" href="/reports">
          Back to my reports
        </Link>
      </div>

      <Notice kind="info">
        Recycled reports still count for the exact-duplicate check, so a new report with the same
        date and the same description will be blocked until this one is restored or permanently
        deleted.
        {config.authz.allowResearcherRestore
          ? ''
          : ' Restoring is reserved for lab admins in this deployment.'}
      </Notice>

      <ReportTable
        reports={reports}
        principal={principal}
        showDeleted
        emptyMessage="Your recycle bin is empty."
      />

      <Pagination
        page={filter.page}
        pageSize={filter.pageSize}
        total={total}
        basePath="/reports/recycle-bin"
        params={params}
      />
    </>
  );
}
