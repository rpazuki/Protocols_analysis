import { NextResponse, type NextRequest } from 'next/server';
import { config } from '../../../server/config.ts';
import { getAuthAdapter } from '../../../server/auth/adapter.ts';
import { destroySession, readSession } from '../../../server/auth/session.ts';
import { appUrl } from '../../../server/urls.ts';

/**
 * Sign-out is POST-only so a stray link or prefetch cannot end someone's
 * session. The local session cookie is always cleared, then the provider's
 * single-logout endpoint is visited if it has one.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const session = await readSession();
  await destroySession();

  let target = appUrl('/auth/signin');
  if (session) {
    try {
      const providerLogout = await getAuthAdapter().logoutUrl({
        logoutHint: session.logoutHint,
        postLogoutRedirectUri: config.appUrl,
      });
      if (providerLogout) target = providerLogout;
    } catch (err) {
      // The local session is already gone; a provider logout failure must not
      // leave the user stuck on an error page.
      console.error('[auth] provider logout failed', err);
    }
  }

  return NextResponse.redirect(target, { status: 303 });
}
