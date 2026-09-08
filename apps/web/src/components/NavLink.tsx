'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Marks the active nav item for assistive technology as well as styling. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // "/reports" must not light up while on "/reports/new" or "/reports/recycle-bin".
  const active = pathname === href || (href !== '/reports' && pathname.startsWith(`${href}/`));

  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
