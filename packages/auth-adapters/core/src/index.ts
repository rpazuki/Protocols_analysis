import { normalizeEmail } from '@protocols/domain';

export const AUTH_ADAPTER_IDS = ['mock', 'local', 'entra-oidc', 'shibboleth-saml'] as const;
export type AuthAdapterId = (typeof AUTH_ADAPTER_IDS)[number];

/**
 * The only identity fields the app is allowed to carry out of an auth
 * provider. Anything else the IdP releases is dropped at this boundary
 * (data minimisation, docs/privacy-security/gdpr-position.md).
 */
export interface AuthClaims {
  /** Normalized (lowercased, trimmed) authenticated email address. This is the app username. */
  email: string;
  /** Local credential revision, used to invalidate sessions after password resets. */
  credentialVersion?: number;
  /** Stable provider subject identifier, for session binding and audit only. */
  subject: string;
  /** Issuer / IdP entityID, for audit. */
  issuer: string;
  /** Development convenience only. Never rendered in production UI as an identity. */
  displayLabel?: string | null;
  /** Opaque token the provider needs back at logout (e.g. OIDC id_token_hint). */
  logoutHint?: string | null;
}

export interface StartLoginResult {
  /** Where to send the browser. */
  redirectUrl: string;
  /**
   * Short-lived values the callback needs back (OIDC state / nonce / PKCE
   * verifier). The web app stores these in a signed, httpOnly, SameSite=Lax
   * cookie and hands them back to completeLogin.
   */
  transaction: Record<string, string>;
}

export interface CompleteLoginParams {
  /** Full callback URL, including query string. */
  requestUrl: string;
  /** Raw request headers, for header-based SP integrations. */
  headers: Headers;
  /** Form body for HTTP-POST bindings (SAML). */
  body?: Record<string, string>;
  /** The transaction values returned by startLogin. */
  transaction: Record<string, string>;
}

export interface LogoutParams {
  logoutHint?: string | null;
  postLogoutRedirectUri: string;
}

export interface AuthAdapter {
  readonly id: AuthAdapterId;
  /** True only for development adapters. The web app refuses to boot with this true in production. */
  readonly isMock: boolean;
  /** Human-readable name for the sign-in button. */
  readonly displayName: string;

  startLogin(params: { returnTo: string; callbackUrl: string }): Promise<StartLoginResult>;
  completeLogin(params: CompleteLoginParams): Promise<AuthClaims>;
  /** Returns null when the provider has no single-logout endpoint to visit. */
  logoutUrl(params: LogoutParams): Promise<string | null>;
}

export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Pulls an email out of provider claims, trying the configured claim name
 * first and then the conventional fallbacks. Throws rather than guessing an
 * identity: an app that mis-attributes a report is worse than one that fails
 * to sign a user in.
 */
export function extractEmail(
  claims: Record<string, unknown>,
  preferredClaim?: string,
): string {
  const candidates = [preferredClaim, 'email', 'preferred_username', 'upn', 'unique_name', 'mail'].filter(
    Boolean,
  ) as string[];

  for (const key of candidates) {
    const value = claims[key];
    if (typeof value === 'string' && value.includes('@')) {
      return normalizeEmail(value);
    }
  }
  throw new AuthError(
    'missing_email_claim',
    `The identity provider did not release an email address. Tried claims: ${candidates.join(', ')}. Ask ICT to release the email attribute.`,
  );
}

/**
 * Optional tenancy guard. When ALLOWED_EMAIL_DOMAINS is configured, a
 * successfully authenticated user from outside those domains is still refused,
 * so a mis-scoped app registration cannot open the lab record to a wider
 * tenant.
 */
export function assertAllowedDomain(email: string, allowedDomains: string[]): void {
  if (allowedDomains.length === 0) return;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const ok = allowedDomains.some((d) => {
    const allowed = d.trim().toLowerCase().replace(/^@/, '');
    return domain === allowed || domain.endsWith(`.${allowed}`);
  });
  if (!ok) {
    throw new AuthError(
      'domain_not_allowed',
      `Sign-in is restricted to approved email domains. "${domain}" is not on the list.`,
    );
  }
}
