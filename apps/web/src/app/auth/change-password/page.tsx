import { notFound, redirect } from 'next/navigation';
import { config } from '../../../server/config.ts';
import { readSession } from '../../../server/auth/session.ts';
import { appUrl } from '../../../server/urls.ts';
import { appPath } from '../../../lib/paths.ts';
import { ChangePasswordForm } from '../../../components/UserForms.tsx';

export default async function ChangePasswordPage() {
  if (config.adapterId !== 'local') notFound();
  const session = await readSession();
  if (!session) redirect(appUrl('/auth/signin'));
  return <>
    <div className="page-header"><div><h1>Change password</h1>
      <p className="lede">{session.mustChangePassword ? 'Set your own password before continuing.' : 'Update your local account password.'}</p>
      <p>{session.email}</p></div></div>
    <ChangePasswordForm />
    <form action={appPath('/auth/signout')} method="post"><button className="btn" type="submit">Sign out</button></form>
  </>;
}
