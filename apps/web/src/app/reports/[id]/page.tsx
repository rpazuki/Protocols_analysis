import Link from 'next/link';
import { notFound } from 'next/navigation';
import { reportsRepo } from '@protocols/db';
import {
  canEditReport,
  canPermanentlyDeleteReport,
  canRecycleReport,
  canRestoreReport,
  canViewReport,
} from '@protocols/domain';
import { config } from '../../../server/config.ts';
import { requirePrincipal } from '../../../server/auth/principal.ts';
import { OutcomeBadge } from '../../../components/OutcomeBadge.tsx';
import { Notice } from '../../../components/Notice.tsx';
import {
  PermanentDeleteForm,
  RecycleButton,
  RestoreButton,
} from '../../../components/ReportActions.tsx';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  const principal = await requirePrincipal(`/reports/${id}`);

  const report = await reportsRepo.getReport(id);
  // A report the user may not view is reported as missing rather than
  // forbidden, so the app does not confirm that someone else's report exists.
  if (!report || !canViewReport(principal, report)) notFound();

  const recycled = report.deletedAt !== null;
  const isOwn = report.researcherEmail === principal.email;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{report.protocolName}</h1>
          <p className="lede">
            {formatDate(report.reportDate)} - {report.protocolTypeLabelSnapshot}
          </p>
        </div>
        <div className="row">
          {!recycled && canEditReport(principal, report) ? (
            <Link className="btn" href={`/reports/${report.id}/edit`}>
              Edit
            </Link>
          ) : null}
          {!recycled ? (
            <Link className="btn" href={`/reports/new?from=${report.id}`}>
              Create from this report
            </Link>
          ) : null}
        </div>
      </div>

      {flags.created ? <Notice kind="success">Report saved.</Notice> : null}
      {flags.updated ? <Notice kind="success">Changes saved.</Notice> : null}

      {recycled ? (
        <Notice kind="warning" title="This report is in the recycle bin.">
          Moved on {formatTimestamp(report.deletedAt)} by {report.deletedBy}. It is excluded from the
          active views and, by default, from exports.
        </Notice>
      ) : null}

      {!isOwn ? (
        <Notice kind="info" title="Another researcher&rsquo;s report.">
          You are seeing this because you are a lab admin. You can recycle or restore it, but only{' '}
          {report.researcherEmail} can edit its contents.
        </Notice>
      ) : null}

      <div className="card">
        <dl className="report-meta">
          <div>
            <dt>Report date</dt>
            <dd>{formatDate(report.reportDate)}</dd>
          </div>
          <div>
            <dt>Researcher</dt>
            <dd>{report.researcherEmail}</dd>
          </div>
          <div>
            <dt>Protocol type</dt>
            <dd>{report.protocolTypeLabelSnapshot}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>
              <OutcomeBadge outcome={report.outcome} />
            </dd>
          </div>
        </dl>

        <h2>Protocol description</h2>
        <div className="freetext">{report.descriptionText}</div>

        <h2>Outcome hypothesis</h2>
        {report.outcomeHypothesis ? (
          <div className="freetext">{report.outcomeHypothesis}</div>
        ) : (
          <p className="cell-secondary">No hypothesis was recorded.</p>
        )}

        <h2>History</h2>
        <dl className="report-meta">
          <div>
            <dt>Created</dt>
            <dd>{formatTimestamp(report.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatTimestamp(report.updatedAt)}</dd>
          </div>
          {report.restoredAt ? (
            <div>
              <dt>Restored</dt>
              <dd>
                {formatTimestamp(report.restoredAt)}
                <div className="cell-secondary">by {report.restoredBy}</div>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="stack" style={{ marginTop: '1rem' }}>
        {!recycled && canRecycleReport(principal, report) ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Delete</h3>
            <p className="hint">
              Deleting moves this report to the recycle bin. You can restore it from there.
            </p>
            <RecycleButton reportId={report.id} />
          </div>
        ) : null}

        {recycled ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Restore</h3>
            {canRestoreReport(principal, report, config.authz) ? (
              <>
                <p className="hint">Restoring returns this report to your active reports.</p>
                <RestoreButton reportId={report.id} />
              </>
            ) : (
              <p className="hint">
                Restoring recycled reports is reserved for lab admins in this deployment.
              </p>
            )}
          </div>
        ) : null}

        {recycled && canPermanentlyDeleteReport(principal, report, config.authz) ? (
          <PermanentDeleteForm reportId={report.id} />
        ) : null}
      </div>
    </>
  );
}
