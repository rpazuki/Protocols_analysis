import { notFound, redirect } from 'next/navigation';
import { AuthError } from '@protocols/auth-core';
import { config } from '../../../server/config.ts';
import { getAuthAdapter } from '../../../server/auth/adapter.ts';
import { createSession, safeReturnTo } from '../../../server/auth/session.ts';
import { getPrincipalSafe } from '../../../server/auth/principal.ts';
import { auditBestEffort } from '../../../server/audit.ts';
import { appUrl } from '../../../server/urls.ts';
import { SubmitButton } from '../../../components/SubmitButton.tsx';
import { Notice } from '../../../components/Notice.tsx';

export default async function LocalSignInPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  if (config.adapterId !== 'local') notFound();
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (await getPrincipalSafe()) redirect(appUrl(returnTo));

  async function signIn(form: FormData) {
    'use server';
    if (config.adapterId !== 'local') notFound();
    const target = safeReturnTo(String(form.get('returnTo') ?? ''));
    let failed = false;
    try {
      const claims = await getAuthAdapter().completeLogin({
        requestUrl: `${config.appUrl}/auth/local`,
        headers: new Headers(),
        body: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') },
        transaction: {},
      });
      await createSession(claims);
      await auditBestEffort({ actorEmail: claims.email, action: 'auth.login', targetType: 'session',
        metadata: { adapter: 'local' } });
    } catch (error) {
      failed = true;
      await auditBestEffort({ actorEmail: 'unknown@invalid', action: 'auth.denied', targetType: 'session',
        metadata: { adapter: 'local', code: error instanceof AuthError ? error.code : 'unexpected' } });
      if (!(error instanceof AuthError)) console.error('[auth] local sign-in failed');
    }
    if (failed) {
      const url = new URL(appUrl('/auth/local'));
      url.searchParams.set('returnTo', target);
      url.searchParams.set('error', 'Sign-in failed. Check your email and password, or contact the administrator.');
      redirect(url.toString());
    }
    redirect(appUrl(target));
  }

  return (
    <>
      <div className="page-header"><div><h1>Sign in</h1>
        <p className="lede">Use the local account provided by your lab administrator.</p>
      </div></div>
      {params.error ? <Notice kind="error" title="Sign-in failed.">{params.error}</Notice> : null}
      <div className="card" style={{ maxWidth: '30rem' }}>
        <form action={signIn}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field"><label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" maxLength={320} required />
          </div>
          <div className="field"><label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
          </div>
          <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
        </form>
      </div>
    </>
  );
}
