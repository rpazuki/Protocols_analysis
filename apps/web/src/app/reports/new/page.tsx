import Link from 'next/link';
import { protocolTypesRepo, reportsRepo } from '@protocols/db';
import { canViewReport, draftFromReport, todayIsoDate } from '@protocols/domain';
import { config } from '../../../server/config.ts';
import { requirePrincipal } from '../../../server/auth/principal.ts';
import { createReportAction } from '../../../server/actions/reports.ts';
import { ReportForm, type ReportFormValues } from '../../../components/ReportForm.tsx';
import { Notice } from '../../../components/Notice.tsx';

/**
 * New report, and "create from this report".
 *
 * When `?from=<id>` is present the form is prefilled from that report but the
 * date still defaults to today, matching "Researcher: Create From Previous
 * Report" step 4.
 */
export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const principal = await requirePrincipal('/reports/new');

  const protocolTypes = await protocolTypesRepo.listProtocolTypes();
  const today = todayIsoDate(config.timeZone);

  let values: ReportFormValues = {
    reportDate: today,
    protocolTypeId: '',
    protocolName: '',
    descriptionText: '',
    outcome: '',
    outcomeHypothesis: '',
  };

  let copiedFrom: string | undefined;
  let sourceMissing = false;

  if (params.from) {
    const source = await reportsRepo.getReport(params.from);
    // A researcher may only copy from a report they are allowed to see.
    if (source && canViewReport(principal, source)) {
      const draft = draftFromReport(source);
      values = {
        reportDate: today,
        protocolTypeId: protocolTypes.some((t) => t.id === draft.protocolTypeId)
          ? (draft.protocolTypeId ?? '')
          : '',
        protocolName: draft.protocolName,
        descriptionText: draft.descriptionText,
        outcome: draft.outcome,
        outcomeHypothesis: draft.outcomeHypothesis ?? '',
      };
      copiedFrom = source.id;
    } else {
      sourceMissing = true;
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{copiedFrom ? 'New report from a previous report' : 'New protocol report'}</h1>
          <p className="lede">
            {copiedFrom
              ? 'Prefilled from your previous report. The date has been reset to today - change the date or the wording before saving.'
              : 'Record one protocol variation and how it turned out.'}
          </p>
        </div>
        <Link className="btn" href="/reports">
          My reports
        </Link>
      </div>

      {sourceMissing ? (
        <Notice kind="warning">
          That report could not be found, so this is a blank form.
        </Notice>
      ) : null}

      {protocolTypes.length === 0 ? (
        <Notice kind="warning" title="No protocol types are available.">
          A lab admin needs to add at least one protocol type before reports can be saved.
        </Notice>
      ) : (
        <ReportForm
          action={createReportAction}
          values={values}
          protocolTypes={protocolTypes}
          researcherEmail={principal.email}
          submitLabel="Save report"
          copiedFromReportId={copiedFrom}
          cancelHref="/reports"
        />
      )}
    </>
  );
}
