import {
  AuthError,
  assertAllowedDomain,
  extractEmail,
  type AuthAdapter,
  type AuthClaims,
  type CompleteLoginParams,
  type LogoutParams,
  type StartLoginResult,
} from '@protocols/auth-core';

/**
 * Shibboleth / SAML production alternative
 * (docs/ict-sso/identity-integration.md).
 *
 * Imperial appears in the UK federation IdP list with entityID
 * `https://shibboleth.imperial.ac.uk/shibboleth`.
 *
 * Implemented in "SP proxy" mode: a Shibboleth Service Provider (the native
 * `shibd` + mod_shib in Apache, or an equivalent in the container's reverse
 * proxy) terminates SAML in front of this app and releases the approved
 * attributes as request headers. The app never parses XML, never handles the
 * SP signing key, and never has to track federation metadata refreshes -
 * which is also how Imperial ICT normally expects an SP to be deployed.
 *
 * SECURITY: header-based identity is only safe when the app is unreachable
 * except through that SP. Two guards are enforced here:
 *   1. `trustedProxyHeaderSecret` - the proxy must inject a shared secret
 *      header that the app checks, so a request that bypasses the proxy and
 *      forges attribute headers is rejected.
 *   2. The `Shib-Session-ID`/session header must be present, so an
 *      unauthenticated pass-through cannot mint a session.
 * Bind the container to localhost and let only the SP reach it.
 */

export interface ShibbolethConfig {
  /** Header carrying the email attribute. ICT confirms the exact name (often `mail` or `eppn`). */
  emailHeader?: string;
  /** Header carrying the SP session id, proving the SP actually authenticated the request. */
  sessionHeader?: string;
  /** Header carrying the display name, development/support use only. */
  displayNameHeader?: string;
  /** Header carrying the persistent SAML subject id. */
  subjectHeader?: string;
  /** IdP entityID, recorded on audit events. */
  idpEntityId?: string;
  /** Path on the SP that starts a session, e.g. /Shibboleth.sso/Login. */
  loginPath?: string;
  /** Path on the SP that ends a session, e.g. /Shibboleth.sso/Logout. */
  logoutPath?: string;
  /** Shared secret the SP injects. Required: without it forged headers are indistinguishable. */
  trustedProxyHeaderSecret: string;
  /** Header name carrying that shared secret. */
  trustedProxyHeaderName?: string;
  allowedDomains?: string[];
}

export const IMPERIAL_IDP_ENTITY_ID = 'https://shibboleth.imperial.ac.uk/shibboleth';

export class ShibbolethSamlAdapter implements AuthAdapter {
  readonly id = 'shibboleth-saml' as const;
  readonly isMock = false;
  readonly displayName = 'Sign in with Imperial College London';

  private readonly config: Required<ShibbolethConfig>;

  constructor(config: ShibbolethConfig) {
    if (!config.trustedProxyHeaderSecret) {
      throw new AuthError(
        'shibboleth_config_incomplete',
        'SHIBBOLETH_PROXY_SECRET must be set. Without it the app cannot tell a real SP request from a forged header.',
      );
    }
    this.config = {
      emailHeader: config.emailHeader ?? 'mail',
      sessionHeader: config.sessionHeader ?? 'shib-session-id',
      displayNameHeader: config.displayNameHeader ?? 'displayname',
      subjectHeader: config.subjectHeader ?? 'persistent-id',
      idpEntityId: config.idpEntityId ?? IMPERIAL_IDP_ENTITY_ID,
      loginPath: config.loginPath ?? '/Shibboleth.sso/Login',
      logoutPath: config.logoutPath ?? '/Shibboleth.sso/Logout',
      trustedProxyHeaderSecret: config.trustedProxyHeaderSecret,
      trustedProxyHeaderName: config.trustedProxyHeaderName ?? 'x-sp-proxy-secret',
      allowedDomains: config.allowedDomains ?? [],
    };
  }

  async startLogin(params: { returnTo: string; callbackUrl: string }): Promise<StartLoginResult> {
    // Hand off to the SP, which performs the SAML AuthnRequest and returns the
    // browser to our callback with attribute headers attached.
    const url = new URL(this.config.loginPath, params.callbackUrl);
    url.searchParams.set('target', params.callbackUrl);
    return { redirectUrl: url.toString(), transaction: { returnTo: params.returnTo } };
  }

  async completeLogin(params: CompleteLoginParams): Promise<AuthClaims> {
    const { headers } = params;

    if (!timingSafeEqual(headers.get(this.config.trustedProxyHeaderName) ?? '', this.config.trustedProxyHeaderSecret)) {
      throw new AuthError(
        'shibboleth_untrusted_request',
        'This request did not come through the Shibboleth service provider.',
      );
    }

    const sessionId = headers.get(this.config.sessionHeader);
    if (!sessionId) {
      throw new AuthError(
        'shibboleth_no_session',
        'No Shibboleth session was found on the request. The service provider did not authenticate this user.',
      );
    }

    const attributes: Record<string, unknown> = {};
    for (const name of [this.config.emailHeader, 'eppn', 'mail', 'email']) {
      const value = headers.get(name);
      if (value) attributes[name] = decodeAttribute(value);
    }

    const email = extractEmail(attributes, this.config.emailHeader);
    assertAllowedDomain(email, this.config.allowedDomains);

    return {
      email,
      subject: headers.get(this.config.subjectHeader) ?? `shib:${email}`,
      issuer: this.config.idpEntityId,
      displayLabel: decodeAttribute(headers.get(this.config.displayNameHeader) ?? '') || null,
      logoutHint: sessionId,
    };
  }

  async logoutUrl(params: LogoutParams): Promise<string | null> {
    const url = new URL(this.config.logoutPath, params.postLogoutRedirectUri);
    url.searchParams.set('return', params.postLogoutRedirectUri);
    return url.toString();
  }
}

/**
 * mod_shib percent-escapes and semicolon-joins multi-valued attributes.
 * Take the first value and unescape it.
 */
function decodeAttribute(raw: string): string {
  const first = raw.split(';')[0] ?? '';
  try {
    return decodeURIComponent(first).trim();
  } catch {
    return first.trim();
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
