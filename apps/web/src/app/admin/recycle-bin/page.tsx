import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { parseReportFilters } from '@protocols/domain';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { ReportTable } from '../../../components/ReportTable.tsx';
import { ReportFilters } from '../../../components/ReportFilters.tsx';
import { Pagination } from '../../../components/Pagination.tsx';
import { Notice } from '../../../components/Notice.tsx';

/** Every recycled report in the lab, for admin restore or permanent delete. */
export default async function AdminRecycleBinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const principal = await requireAdmin('/admin/recycle-bin');

  const filter = parseReportFilters(params, { forceState: 'recycled' });
  const [{ reports, total }, protocolTypes, researcherEmails] = await Promise.all([
    reportsRepo.listReports(filter),
    protocolTypesRepo.listProtocolTypes({ includeInactive: true }),
    reportsRepo.listResearcherEmails(),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Lab recycle bin</h1>
          <p className="lede">Recycled reports from every researcher.</p>
        </div>
      </div>

      <Notice kind="warning">
        Permanent deletion removes the report text from the database and cannot be undone. Open a
        report to restore or permanently delete it.
      </Notice>

      <ReportFilters
        action="/admin/recycle-bin"
        values={params}
        protocolTypes={protocolTypes}
        researcherEmails={researcherEmails}
      />

      <ReportTable
        reports={reports}
        principal={principal}
        showResearcher
        showDeleted
        emptyMessage="No recycled reports."
      />

      <Pagination
        page={filter.page}
        pageSize={filter.pageSize}
        total={total}
        basePath="/admin/recycle-bin"
        params={params}
      />
    </>
  );
}
