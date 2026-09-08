import { auditRepo } from '@protocols/db';
import { AUDIT_ACTIONS } from '@protocols/domain';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { Pagination } from '../../../components/Pagination.tsx';
import { Notice } from '../../../components/Notice.tsx';
import { appPath } from '../../../lib/paths.ts';

/**
 * Read-only audit trail. The application role holds INSERT and SELECT on
 * audit_events only, so nothing in the app can edit or delete these rows.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  await requireAdmin('/admin/audit');

  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const pageSize = 50;

  const { events, total } = await auditRepo.listAuditEvents({
    actorEmail: params.actorEmail || undefined,
    action: params.action || undefined,
    targetType: params.targetType || undefined,
    targetId: params.targetId || undefined,
    page,
    pageSize,
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit events</h1>
          <p className="lede">
            Sensitive operations: report changes, recycle-bin moves, restores, permanent deletes,
            protocol-type and admin changes, agreement acceptances, and exports.
          </p>
        </div>
      </div>

      <Notice kind="info">
        Audit metadata deliberately excludes report free text, so this page never becomes a second
        copy of the lab record.
      </Notice>

      <form className="filters" method="get" action={appPath('/admin/audit')}>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="a-actor">Actor email</label>
            <input id="a-actor" name="actorEmail" type="email" defaultValue={params.actorEmail ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="a-action">Action</label>
            <select id="a-action" name="action" defaultValue={params.action ?? ''}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-target">Target id</label>
            <input id="a-target" name="targetId" type="text" defaultValue={params.targetId ?? ''} />
          </div>
        </div>
        <div className="row row--end" style={{ paddingBottom: '1rem' }}>
          <a className="btn" href={appPath('/admin/audit')}>
            Clear
          </a>
          <button className="btn btn--primary" type="submit">
            Apply filters
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <p className="empty-state">No audit events match these filters.</p>
                </td>
              </tr>
            ) : null}
            {events.map((event) => (
              <tr key={event.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {new Date(event.createdAt).toLocaleString('en-GB', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </td>
                <td>{event.actorEmail}</td>
                <td>
                  <code>{event.action}</code>
                </td>
                <td>
                  <div>{event.targetType}</div>
                  {event.targetId ? <div className="cell-secondary">{event.targetId}</div> : null}
                </td>
                <td>
                  <code className="cell-secondary">{JSON.stringify(event.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/audit"
        params={params}
      />
    </>
  );
}
