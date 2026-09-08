import Link from 'next/link';
import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { parseReportFilters } from '@protocols/domain';
import { requirePrincipal } from '../../server/auth/principal.ts';
import { ReportTable } from '../../components/ReportTable.tsx';
import { ReportFilters } from '../../components/ReportFilters.tsx';
import { Pagination } from '../../components/Pagination.tsx';

/**
 * A researcher's own active reports.
 *
 * The owner scope is passed to the repository, so this page cannot show
 * another researcher's records even for an admin - admins use /admin/reports
 * for the lab-wide view.
 */
export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const principal = await requirePrincipal('/reports');

  const filter = parseReportFilters(params, { forceState: 'active' });
  const [{ reports, total }, protocolTypes] = await Promise.all([
    reportsRepo.listReports(filter, principal.email),
    protocolTypesRepo.listProtocolTypes({ includeInactive: true }),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>My reports</h1>
          <p className="lede">Your active protocol reports. Recycled reports are in the recycle bin.</p>
        </div>
        <Link className="btn btn--primary" href="/reports/new">
          New report
        </Link>
      </div>

      <ReportFilters action="/reports" values={params} protocolTypes={protocolTypes} />

      <ReportTable
        reports={reports}
        principal={principal}
        emptyMessage={
          Object.keys(params).length > 0
            ? 'No reports match these filters.'
            : 'You have not recorded any protocol reports yet.'
        }
      />

      <Pagination
        page={filter.page}
        pageSize={filter.pageSize}
        total={total}
        basePath="/reports"
        params={params}
      />
    </>
  );
}
