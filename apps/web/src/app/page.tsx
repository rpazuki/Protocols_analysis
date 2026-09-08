import { redirect } from 'next/navigation';
import { getPrincipalSafe } from '../server/auth/principal.ts';

/** The landing page is the daily report form for a signed-in researcher. */
export default async function HomePage() {
  const principal = await getPrincipalSafe();
  redirect(principal ? '/reports/new' : '/auth/signin');
}
