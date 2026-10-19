import { notFound, redirect } from 'next/navigation';
import { appUrl } from '../../../server/urls.ts';
import { DEFAULT_MOCK_PERSONAS, MockAuthAdapter } from '@protocols/auth-mock';
import { config, isProduction } from '../../../server/config.ts';
import { getAuthAdapter } from '../../../server/auth/adapter.ts';
import { createSession, safeReturnTo, takeAuthTransaction } from '../../../server/auth/session.ts';
import { auditBestEffort } from '../../../server/audit.ts';
import { SubmitButton } from '../../../components/SubmitButton.tsx';
import { Notice } from '../../../components/Notice.tsx';

/**
 * Development-only persona picker.
 *
 * Guarded three ways: the route 404s unless the mock adapter is selected, the
 * adapter itself refuses to construct in production, and config.ts refuses to
 * load a production build with AUTH_ADAPTER=mock.
 */
export default async function MockSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  if (isProduction || config.adapterId !== 'mock') notFound();

  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);

  async function signInAsPersona(formData: FormData) {
    'use server';
    if (isProduction || config.adapterId !== 'mock') notFound();

    const adapter = getAuthAdapter() as MockAuthAdapter;
    const transaction = await takeAuthTransaction();
    const target = safeReturnTo(String(formData.get('returnTo') ?? '') || transaction.returnTo);

    const claims = await adapter.completeLogin({
      requestUrl: `${config.appUrl}/auth/mock`,
      headers: new Headers(),
      body: {
        persona: String(formData.get('persona') ?? ''),
        email: String(formData.get('email') ?? ''),
      },
      transaction,
    });

    await createSession(claims);
    await auditBestEffort({
      actorEmail: claims.email,
      action: 'auth.login',
      targetType: 'session',
      metadata: { adapter: 'mock' },
    });

    redirect(appUrl(target));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Mock sign-in</h1>
          <p className="lede">
            Choose a development persona. These accounts exist only in this local database.
          </p>
        </div>
      </div>

      <Notice kind="warning" title="Development only.">
        This page does not exist in a production build. Real sign-in goes through Imperial SSO.
      </Notice>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Preset personas</h2>
        {DEFAULT_MOCK_PERSONAS.map((persona) => (
          <form key={persona.key} action={signInAsPersona} className="row" style={{ marginBottom: '0.75rem' }}>
            <input type="hidden" name="persona" value={persona.key} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <span style={{ minWidth: '15rem' }}>
              <strong>{persona.displayLabel}</strong>
              <br />
              <span className="cell-secondary">{persona.email}</span>
            </span>
            {persona.admin ? <span className="badge badge--admin">Admin</span> : null}
            <span className="spacer" />
            <SubmitButton className="btn" pendingLabel="Signing in...">
              Sign in
            </SubmitButton>
          </form>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Any other test address</h2>
        <form action={signInAsPersona}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="field">
            <label htmlFor="email">Mock email address</label>
            <input id="email" name="email" type="email" placeholder="test.person@ic.ac.uk" required />
            <span className="hint">
              Useful for checking that one researcher cannot see another&rsquo;s reports.
            </span>
          </div>
          <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
        </form>
      </div>
    </>
  );
}
