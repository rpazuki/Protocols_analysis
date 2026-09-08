import Link from 'next/link';
import type { Principal, ProtocolReport } from '@protocols/domain';
import { OutcomeBadge } from './OutcomeBadge.tsx';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export function ReportTable({
  reports,
  principal,
  showResearcher = false,
  showDeleted = false,
  emptyMessage,
}: {
  reports: ProtocolReport[];
  principal: Principal;
  showResearcher?: boolean;
  showDeleted?: boolean;
  emptyMessage: string;
}) {
  if (reports.length === 0) {
    return (
      <div className="table-wrap">
        <p className="empty-state">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {showResearcher ? <th scope="col">Researcher</th> : null}
            <th scope="col">Protocol type</th>
            <th scope="col">Protocol name</th>
            <th scope="col">Outcome</th>
            {showDeleted ? <th scope="col">Recycled</th> : null}
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id}>
              <td>{formatDate(report.reportDate)}</td>
              {showResearcher ? (
                <td>
                  {report.researcherEmail}
                  {report.researcherEmail === principal.email ? (
                    <div className="cell-secondary">you</div>
                  ) : null}
                </td>
              ) : null}
              <td>{report.protocolTypeLabelSnapshot}</td>
              <td>
                <Link href={`/reports/${report.id}`}>{report.protocolName}</Link>
              </td>
              <td>
                <OutcomeBadge outcome={report.outcome} />
              </td>
              {showDeleted ? (
                <td>
                  {report.deletedAt ? (
                    <>
                      <div className="cell-secondary">{formatTimestamp(report.deletedAt)}</div>
                      <div className="cell-secondary">by {report.deletedBy}</div>
                    </>
                  ) : (
                    <span className="badge badge--success">Active</span>
                  )}
                </td>
              ) : null}
              <td className="actions">
                <Link className="btn btn--sm" href={`/reports/${report.id}`}>
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
