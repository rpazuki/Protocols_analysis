import 'server-only';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthClaims } from '@protocols/auth-core';
import { normalizeEmail } from '@protocols/domain';
import { localAuthRepo } from '@protocols/db';
import { config, isProduction } from '../config.ts';
import { appBasePath } from '../../lib/paths.ts';

/**
 * Session state is a signed JWT in an httpOnly cookie.
 *
 * It carries identity only - never a role. Admin status is re-read from the
 * database allowlist on every request, so removing an admin takes effect
 * immediately instead of waiting for their session to expire.
 */

export const SESSION_COOKIE = 'protocols_session';
export const TRANSACTION_COOKIE = 'protocols_auth_tx';

export interface SessionPayload {
  email: string;
  credentialVersion: number | null;
  mustChangePassword: boolean;
  subject: string;
  issuer: string;
  isMock: boolean;
  displayLabel: string | null;
  logoutHint: string | null;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config.sessionSecret);
}

const baseCookieOptions = {
  httpOnly: true,
  // Lax rather than Strict: the IdP redirects the browser back to the callback
  // as a top-level GET, which a Strict cookie would not accompany.
  sameSite: 'lax' as const,
  secure: isProduction,
  path: appBasePath || '/',
};

export async function createSession(claims: AuthClaims): Promise<void> {
  const token = await new SignJWT({
    email: normalizeEmail(claims.email),
    subject: claims.subject,
    issuer: claims.issuer,
    credentialVersion: claims.credentialVersion,
    isMock: claims.issuer === 'mock-auth-adapter',
    displayLabel: claims.displayLabel ?? null,
    logoutHint: claims.logoutHint ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlHours}h`)
    .sign(secretKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...baseCookieOptions,
    maxAge: config.sessionTtlHours * 3600,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!email) return null;

    const isMock = payload.isMock === true;
    // Defence in depth: a session minted by a development build must never be
    // honoured by a production container, even if the cookie secret leaked
    // across environments.
    if (isMock && isProduction) return null;
    let mustChangePassword = false;
    if (payload.issuer === 'local-password') {
      if (config.adapterId !== 'local' || !Number.isSafeInteger(payload.credentialVersion)) return null;
      const state = await localAuthRepo.sessionState(email, Number(payload.credentialVersion));
      if (!state) return null;
      mustChangePassword = state.mustChangePassword;
    } else if (config.adapterId === 'local') {
      // Switching to local login must not accept an old SSO/mock cookie.
      return null;
    }

    return {
      email,
      credentialVersion: payload.issuer === 'local-password' ? Number(payload.credentialVersion) : null,
      mustChangePassword,
      subject: String(payload.subject ?? ''),
      issuer: String(payload.issuer ?? ''),
      isMock,
      displayLabel: (payload.displayLabel as string | null) ?? null,
      logoutHint: (payload.logoutHint as string | null) ?? null,
    };
  } catch {
    // Expired or tampered token: treat as signed out.
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...baseCookieOptions, maxAge: 0 });
  store.set(TRANSACTION_COOKIE, '', { ...baseCookieOptions, maxAge: 0 });
}

/** Stores the short-lived OIDC/SAML sign-in transaction (state, nonce, PKCE verifier). */
export async function setAuthTransaction(transaction: Record<string, string>): Promise<void> {
  const token = await new SignJWT({ tx: transaction })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey());

  const store = await cookies();
  store.set(TRANSACTION_COOKIE, token, { ...baseCookieOptions, maxAge: 600 });
}

export async function takeAuthTransaction(): Promise<Record<string, string>> {
  const store = await cookies();
  const token = store.get(TRANSACTION_COOKIE)?.value;
  store.set(TRANSACTION_COOKIE, '', { ...baseCookieOptions, maxAge: 0 });
  if (!token) return {};
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return (payload.tx as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Only same-origin relative paths may be used as post-login redirect targets,
 * so a crafted `returnTo` cannot bounce a signed-in user to another site.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/reports'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
