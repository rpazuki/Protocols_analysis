import { NextResponse, type NextRequest } from 'next/server';
import { AuthError } from '@protocols/auth-core';
import { getAuthAdapter } from '../../../server/auth/adapter.ts';
import { createSession, safeReturnTo, takeAuthTransaction } from '../../../server/auth/session.ts';
import { auditBestEffort } from '../../../server/audit.ts';
import { appUrl } from '../../../server/urls.ts';

/**
 * Identity provider callback.
 *
 * GET handles the OIDC query-parameter response and the Shibboleth SP
 * redirect; POST handles a SAML HTTP-POST binding if ICT requires one.
 */

async function handle(request: NextRequest, body?: Record<string, string>): Promise<NextResponse> {
  const adapter = getAuthAdapter();
  // Local credentials are accepted only by the same-origin server action.
  if (adapter.id === 'local') return new NextResponse(null, { status: 404 });
  const transaction = await takeAuthTransaction();

  try {
    const claims = await adapter.completeLogin({
      requestUrl: request.url,
      headers: request.headers,
      body,
      transaction,
    });

    await createSession(claims);
    await auditBestEffort({
      actorEmail: claims.email,
      action: 'auth.login',
      targetType: 'session',
      metadata: { adapter: adapter.id, issuer: claims.issuer },
    });

    return NextResponse.redirect(appUrl(safeReturnTo(transaction.returnTo)));
  } catch (err) {
    // Failed sign-ins are audited without an actor: we do not have a trusted
    // identity, and echoing an attacker-supplied email into the audit trail
    // would let anyone write rows.
    await auditBestEffort({
      actorEmail: 'unknown@invalid',
      action: 'auth.denied',
      targetType: 'session',
      metadata: {
        adapter: adapter.id,
        code: err instanceof AuthError ? err.code : 'unexpected',
      },
    });

    const message =
      err instanceof AuthError
        ? err.message
        : 'Sign-in could not be completed. Try again, and tell the lab admin if it keeps failing.';
    if (!(err instanceof AuthError)) console.error('[auth] callback failed', err);

    const url = new URL(appUrl('/auth/signin'));
    url.searchParams.set('error', message);
    return NextResponse.redirect(url);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const body: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') body[key] = value;
  }
  return handle(request, body);
}
