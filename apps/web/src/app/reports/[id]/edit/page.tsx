import { notFound } from 'next/navigation';
import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { canEditReport, canViewReport } from '@protocols/domain';
import { requirePrincipal } from '../../../../server/auth/principal.ts';
import { updateReportAction } from '../../../../server/actions/reports.ts';
import { ReportForm } from '../../../../components/ReportForm.tsx';
import { Notice } from '../../../../components/Notice.tsx';

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requirePrincipal(`/reports/${id}/edit`);

  const report = await reportsRepo.getReport(id);
  if (!report || !canViewReport(principal, report)) notFound();

  // Editing is owner-only, even for admins: an admin rewriting someone else's
  // record would break attribution.
  if (!canEditReport(principal, report)) {
    return (
      <>
        <div className="page-header">
          <h1>Cannot edit this report</h1>
        </div>
        <Notice kind="error">
          {report.deletedAt
            ? 'This report is in the recycle bin. Restore it before editing.'
            : `Only ${report.researcherEmail} can edit this report.`}
        </Notice>
      </>
    );
  }

  const protocolTypes = await protocolTypesRepo.listProtocolTypes();
  // A report can point at a type an admin has since disabled. The type stays
  // out of the dropdown, so tell the user why rather than silently blanking it.
  const typeStillSelectable = protocolTypes.some((t) => t.id === report.protocolTypeId);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Edit report</h1>
          <p className="lede">
            Changing the date or the description here is checked against the same exact-duplicate
            rule as a new report.
          </p>
        </div>
      </div>

      <ReportForm
        action={updateReportAction}
        reportId={report.id}
        values={{
          reportDate: report.reportDate,
          protocolTypeId: typeStillSelectable ? (report.protocolTypeId ?? '') : '',
          protocolName: report.protocolName,
          descriptionText: report.descriptionText,
          outcome: report.outcome,
          outcomeHypothesis: report.outcomeHypothesis ?? '',
        }}
        protocolTypes={protocolTypes}
        researcherEmail={principal.email}
        submitLabel="Save changes"
        cancelHref={`/reports/${report.id}`}
        retiredTypeLabel={typeStillSelectable ? null : report.protocolTypeLabelSnapshot}
      />
    </>
  );
}
