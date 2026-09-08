import { adminsRepo } from '@protocols/db';
import { config } from '../../../server/config.ts';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { AddAdminForm, RemoveAdminForm } from '../../../components/AdminForms.tsx';
import { Notice } from '../../../components/Notice.tsx';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminAllowlistPage() {
  const principal = await requireAdmin('/admin/admins');
  const admins = await adminsRepo.listAdmins();
  const configAdmins = admins.filter((a) => a.fromConfig);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Admins</h1>
          <p className="lede">
            Who can manage protocol types, view every report, and export lab data. Every change here
            is audited.
          </p>
        </div>
      </div>

      <Notice kind="info" title="Recovery path.">
        Admins marked <strong>from config</strong> come from <code>ADMIN_BOOTSTRAP_EMAILS</code> in
        deployment configuration and cannot be removed here - editing that value on the VM and
        restarting the app is the documented break-glass route. The last remaining admin cannot be
        removed either.
      </Notice>

      <AddAdminForm allowedDomains={config.allowedEmailDomains} />

      <h2>Current admins ({admins.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Source</th>
              <th scope="col">Added</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const isSelf = admin.email === principal.email;
              const isLast = admins.length <= 1;
              return (
                <tr key={admin.email}>
                  <td>
                    {admin.email}
                    {isSelf ? <div className="cell-secondary">you</div> : null}
                  </td>
                  <td>
                    {admin.fromConfig ? (
                      <span className="badge badge--admin">From config</span>
                    ) : (
                      <span className="cell-secondary">Added in app</span>
                    )}
                  </td>
                  <td>
                    {formatTimestamp(admin.addedAt)}
                    <div className="cell-secondary">by {admin.addedBy}</div>
                  </td>
                  <td className="actions">
                    {admin.fromConfig ? (
                      <span className="cell-secondary">Edit deployment config</span>
                    ) : isLast ? (
                      <span className="cell-secondary">Last admin - protected</span>
                    ) : (
                      <RemoveAdminForm email={admin.email} isSelf={isSelf} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {configAdmins.length === 0 ? (
        <Notice kind="warning" title="No config-backed admin.">
          Nothing in <code>ADMIN_BOOTSTRAP_EMAILS</code> matches a current admin. If every in-app
          admin is removed or loses access, there is no configuration-based way back in. Set that
          variable on the VM.
        </Notice>
      ) : null}
    </>
  );
}
