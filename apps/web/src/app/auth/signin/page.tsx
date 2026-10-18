import { redirect } from 'next/navigation';
import { config } from '../../../server/config.ts';
import { getAuthAdapter } from '../../../server/auth/adapter.ts';
import { getPrincipalSafe } from '../../../server/auth/principal.ts';
import { safeReturnTo, setAuthTransaction } from '../../../server/auth/session.ts';
import { SubmitButton } from '../../../components/SubmitButton.tsx';
import { Notice } from '../../../components/Notice.tsx';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);

  const principal = await getPrincipalSafe();
  if (principal) redirect(returnTo);

  const adapter = getAuthAdapter();

  /** Starts the provider handshake and stores the sign-in transaction. */
  async function startSignIn(formData: FormData) {
    'use server';
    const target = safeReturnTo(String(formData.get('returnTo') ?? ''));
    const started = await getAuthAdapter().startLogin({
      returnTo: target,
      callbackUrl: `${config.appUrl}/auth/callback`,
    });
    await setAuthTransaction(started.transaction);
    redirect(started.redirectUrl);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{config.appName}</h1>
          <p className="lede">
            Record daily protocol variations and outcomes.{' '}
            {config.adapterId === 'local'
              ? 'Sign in with your local email and password to continue.'
              : 'Sign in with your Imperial account to continue.'}
          </p>
        </div>
      </div>

      {params.error ? (
        <Notice kind="error" title="Sign-in failed.">
          {decodeURIComponent(params.error)}
        </Notice>
      ) : null}

      {adapter.isMock ? (
        <Notice kind="warning" title="Development mode.">
          This instance uses mock sign-in. Nothing here is connected to Imperial SSO, and no real
          lab data should be entered.
        </Notice>
      ) : null}

      <div className="card">
        <form action={startSignIn}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton pendingLabel="Redirecting...">{adapter.displayName}</SubmitButton>
        </form>
      </div>
    </>
  );
}
