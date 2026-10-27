import { notFound } from 'next/navigation';
import { localAuthRepo } from '@protocols/db';
import { requireAdmin } from '../../../server/auth/principal.ts';
import { config } from '../../../server/config.ts';
import { CreateUserForm, UserOperationForm } from '../../../components/UserForms.tsx';
import { Pagination } from '../../../components/Pagination.tsx';

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const principal = await requireAdmin('/admin/users');
  if (config.adapterId !== 'local') notFound();
  const params = await searchParams;
  const search = (params.search ?? '').slice(0,320);
  const page = Math.min(1000000,Math.max(1,Math.floor(Number(params.page) || 1)));
  const { accounts, total } = await localAuthRepo.listAccounts(search,page,25);
  return <>
    <div className="page-header"><div><h1>Users</h1><p className="lede">Manage local email/password accounts. Account and role changes are audited. Existing reports are preserved.</p></div></div>
    <CreateUserForm />
    <form method="get" className="field"><label htmlFor="search-users">Find users by email</label>
      <input type="search" id="search-users" name="search" defaultValue={search} maxLength={320} /><button className="btn" type="submit">Search users</button></form>
    <p>{total} local account{total === 1 ? '' : 's'}</p>
    <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead>
      <tbody>{accounts.map(user => <tr key={user.email}>
        <td>{user.email}{user.email === principal.email ? ' (you)' : ''}{user.from_config ? <div className="cell-secondary">Protected by configuration</div> : null}</td>
        <td>{user.is_admin ? 'Administrator' : 'Researcher'}</td>
        <td>{!user.is_active ? 'Disabled' : user.blocked ? 'Access blocked' : 'Active'}
          {user.must_change_password ? <div className="cell-secondary">Password change required</div> : null}
          {user.locked_until && new Date(user.locked_until) > new Date() ? <div className="cell-secondary">Temporarily locked</div> : null}</td>
        <td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString('en-GB', { timeZone: config.timeZone, timeZoneName: 'short' }) : 'Never'}</td>
        <td>
          <UserOperationForm email={user.email} operation="reset" label="Reset password" disabled={user.email === principal.email} />
          <UserOperationForm email={user.email} operation={user.is_active ? 'disable' : 'reactivate'} label={user.is_active ? 'Disable account' : 'Reactivate account'} disabled={user.is_active && (user.from_config || user.email === principal.email)} />
          <UserOperationForm email={user.email} operation={user.is_admin ? 'demote' : 'promote'} label={user.is_admin ? 'Make researcher' : 'Make administrator'} disabled={user.is_admin ? user.from_config : !user.is_active || user.blocked} />
        </td></tr>)}</tbody></table></div>
    {!accounts.length ? <p>No matching local accounts.</p> : null}
    <Pagination page={page} pageSize={25} total={total} basePath="/admin/users" params={{ search }} />
  </>;
}
