import Link from 'next/link';
import type { Principal } from '@protocols/domain';
import { NavLink } from './NavLink.tsx';
import { appPath } from '../lib/paths.ts';

/**
 * The signed-in email is shown here and nowhere else as an editable value:
 * identity comes from the session and the UI must present it read-only
 * (product-overview.md, "Researcher: cannot edit the authenticated
 * email/username").
 */
export function SiteHeader({ principal, appName }: { principal: Principal | null; appName: string }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href={principal ? '/reports' : '/'}>
          {appName}
        </Link>

        {principal ? (
          <>
            <nav className="site-nav" aria-label="Main">
              <NavLink href="/reports/new">New report</NavLink>
              <NavLink href="/reports">My reports</NavLink>
              <NavLink href="/reports/recycle-bin">Recycle bin</NavLink>
              {principal.role === 'admin' ? (
                <>
                  <NavLink href="/admin/reports">All reports</NavLink>
                  <NavLink href="/admin/protocol-types">Protocol types</NavLink>
                  <NavLink href="/admin/export">Export</NavLink>
                  <NavLink href="/admin/admins">Admins</NavLink>
                  <NavLink href="/admin/access">Access</NavLink>
                  <NavLink href="/admin/audit">Audit</NavLink>
                </>
              ) : null}
            </nav>

            <div className="identity">
              {principal.isMock ? <span className="badge badge--mock">Mock user</span> : null}
              {principal.role === 'admin' ? <span className="badge badge--admin">Admin</span> : null}
              <span className="identity__email" title="Signed-in account">
                {principal.email}
              </span>
              <form action={appPath('/auth/signout')} method="post">
                <button className="btn btn--sm" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
