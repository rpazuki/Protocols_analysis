import { denylistRepo } from '@protocols/db';
import { config } from '../../../server/config.ts';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { DenyAccessForm, RestoreAccessForm } from '../../../components/DenylistForms.tsx';
import { Notice } from '../../../components/Notice.tsx';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Researcher access denylist.
 *
 * There is deliberately no researcher allowlist: Imperial SSO is the
 * membership check, and gating every new lab member on an admin action would
 * mean someone is always waiting to record their first protocol.
 */
export default async function AccessPage() {
  await requireAdmin('/admin/access');

  const entries = await denylistRepo.listDenylist({ includeLifted: true });
  const active = entries.filter((e) => e.removedAt === null);
  const lifted = entries.filter((e) => e.removedAt !== null);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Access</h1>
          <p className="lede">
            Anyone Imperial authenticates can use this app, except the addresses blocked here.
          </p>
        </div>
      </div>

      <Notice kind="info" title="How access works.">
        Sign-in is open to everyone Imperial authenticates
        {config.allowedEmailDomains.length
          ? ` on an approved domain (${config.allowedEmailDomains.join(', ')})`
          : ''}
        . Blocking an address refuses it after sign-in succeeds, so the person is told the app
        withdrew their access rather than being left thinking their Imperial login is broken.
        Blocking does not delete their reports, and it does not remove admin rights &mdash; remove
        someone as an admin first if that is what you mean.
      </Notice>

      <Notice kind="info" title="Blocks set in deployment config.">
        An address listed in <code>ACCESS_DENYLIST_EMAILS</code> is pinned: it is re-applied on
        every restart, so it cannot be lifted here. Take it out of that variable and restart to
        unpin it. The block itself stays in force after unpinning &mdash; tidying a config file
        should not quietly give someone their access back &mdash; but it becomes an ordinary entry
        you can then restore below.
      </Notice>

      <DenyAccessForm />

      <h2>Blocked ({active.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Reason</th>
              <th scope="col">Source</th>
              <th scope="col">Blocked</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <p className="empty-state">Nobody is blocked.</p>
                </td>
              </tr>
            ) : null}
            {active.map((entry) => (
              <tr key={entry.email}>
                <td>{entry.email}</td>
                <td>{entry.reason ?? <span className="cell-secondary">No reason recorded</span>}</td>
                <td>
                  {entry.fromConfig ? (
                    <span className="badge badge--admin">From config</span>
                  ) : (
                    <span className="cell-secondary">Blocked in app</span>
                  )}
                </td>
                <td>
                  {formatTimestamp(entry.addedAt)}
                  <div className="cell-secondary">by {entry.addedBy}</div>
                </td>
                <td className="actions">
                  {entry.fromConfig ? (
                    <span className="cell-secondary">
                      Pinned by config &mdash; remove from ACCESS_DENYLIST_EMAILS and restart
                    </span>
                  ) : (
                    <RestoreAccessForm email={entry.email} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lifted.length > 0 ? (
        <>
          <h2>Previously blocked ({lifted.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Reason given at the time</th>
                  <th scope="col">Restored</th>
                </tr>
              </thead>
              <tbody>
                {lifted.map((entry) => (
                  <tr key={entry.email}>
                    <td>{entry.email}</td>
                    <td>{entry.reason ?? <span className="cell-secondary">No reason recorded</span>}</td>
                    <td>
                      {formatTimestamp(entry.removedAt)}
                      <div className="cell-secondary">by {entry.removedBy}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
