import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { parseReportFilters } from '@protocols/domain';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { ReportTable } from '../../../components/ReportTable.tsx';
import { ReportFilters } from '../../../components/ReportFilters.tsx';
import { Pagination } from '../../../components/Pagination.tsx';

/** Lab-wide report view. Admin only; no owner scope is passed to the repository. */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const principal = await requireAdmin('/admin/reports');

  const filter = parseReportFilters(params);
  const [{ reports, total }, protocolTypes, researcherEmails] = await Promise.all([
    reportsRepo.listReports(filter),
    protocolTypesRepo.listProtocolTypes({ includeInactive: true }),
    reportsRepo.listResearcherEmails(),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>All reports</h1>
          <p className="lede">Every protocol report in the lab. Filter, search, and open any record.</p>
        </div>
      </div>

      <ReportFilters
        action="/admin/reports"
        values={params}
        protocolTypes={protocolTypes}
        researcherEmails={researcherEmails}
        showState
      />

      <ReportTable
        reports={reports}
        principal={principal}
        showResearcher
        showDeleted={filter.state !== 'active'}
        emptyMessage="No reports match these filters."
      />

      <Pagination
        page={filter.page}
        pageSize={filter.pageSize}
        total={total}
        basePath="/admin/reports"
        params={params}
      />
    </>
  );
}
