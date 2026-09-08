import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
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
 * Microsoft Entra ID via OpenID Connect authorization code flow with PKCE.
 *
 * This is the production-preferred path (docs/ict-sso/identity-integration.md).
 * It is a confidential client: the code exchange happens server-side with the
 * client secret, and the id_token signature is verified against the tenant
 * JWKS before any claim is trusted.
 *
 * Nothing here activates until ICT supplies tenant authority, client id, and
 * secret. Without them the web app will not select this adapter.
 */

export interface EntraOidcConfig {
  /** e.g. https://login.microsoftonline.com/<tenant-id>/v2.0 */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Registered redirect URI. Must match the app registration exactly. */
  redirectUri: string;
  postLogoutRedirectUri?: string;
  /** Defaults to "openid profile email". */
  scopes?: string[];
  /** Claim ICT confirms carries the Imperial email address. */
  emailClaim?: string;
  allowedDomains?: string[];
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  issuer: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function randomString(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export class EntraOidcAdapter implements AuthAdapter {
  readonly id = 'entra-oidc' as const;
  readonly isMock = false;
  readonly displayName = 'Sign in with Imperial account';

  private readonly config: Required<Omit<EntraOidcConfig, 'postLogoutRedirectUri'>> &
    Pick<EntraOidcConfig, 'postLogoutRedirectUri'>;
  private discoveryCache: Promise<OidcDiscovery> | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: EntraOidcConfig) {
    if (!config.issuer || !config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new AuthError(
        'entra_config_incomplete',
        'Entra OIDC requires issuer, clientId, clientSecret, and redirectUri from the ICT app registration.',
      );
    }
    this.config = {
      issuer: config.issuer.replace(/\/$/, ''),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      postLogoutRedirectUri: config.postLogoutRedirectUri,
      scopes: config.scopes ?? ['openid', 'profile', 'email'],
      emailClaim: config.emailClaim ?? 'email',
      allowedDomains: config.allowedDomains ?? [],
    };
  }

  private async discover(): Promise<OidcDiscovery> {
    if (!this.discoveryCache) {
      const url = `${this.config.issuer}/.well-known/openid-configuration`;
      this.discoveryCache = fetch(url, { headers: { accept: 'application/json' } })
        .then(async (res) => {
          if (!res.ok) {
            throw new AuthError('entra_discovery_failed', `OIDC discovery failed (${res.status}) for ${url}.`);
          }
          return (await res.json()) as OidcDiscovery;
        })
        .catch((err) => {
          this.discoveryCache = null;
          throw err;
        });
    }
    return this.discoveryCache;
  }

  private async getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (!this.jwks) {
      const discovery = await this.discover();
      this.jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    }
    return this.jwks;
  }

  async startLogin(params: { returnTo: string; callbackUrl: string }): Promise<StartLoginResult> {
    const discovery = await this.discover();
    const state = randomString();
    const nonce = randomString();
    const codeVerifier = randomString(48);
    const codeChallenge = await pkceChallenge(codeVerifier);

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return {
      redirectUrl: url.toString(),
      transaction: { state, nonce, codeVerifier, returnTo: params.returnTo },
    };
  }

  async completeLogin(params: CompleteLoginParams): Promise<AuthClaims> {
    const url = new URL(params.requestUrl);
    const error = url.searchParams.get('error');
    if (error) {
      throw new AuthError(
        'entra_authorize_error',
        `Identity provider returned "${error}": ${url.searchParams.get('error_description') ?? 'no description'}.`,
      );
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const { state, nonce, codeVerifier } = params.transaction;

    if (!code) throw new AuthError('entra_no_code', 'Authorization code missing from the callback.');
    if (!state || !returnedState || returnedState !== state) {
      throw new AuthError('entra_state_mismatch', 'Sign-in state did not match. Start sign-in again.');
    }
    if (!codeVerifier) throw new AuthError('entra_no_verifier', 'PKCE verifier missing from the sign-in transaction.');

    const discovery = await this.discover();
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      // The body can carry the client secret back in an error echo; do not log it.
      throw new AuthError('entra_token_exchange_failed', `Token exchange failed (${tokenRes.status}).`);
    }

    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new AuthError('entra_no_id_token', 'Token response did not include an id_token.');

    const jwks = await this.getJwks();
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: discovery.issuer,
      audience: this.config.clientId,
      clockTolerance: 60,
    });

    if (!nonce || payload.nonce !== nonce) {
      throw new AuthError('entra_nonce_mismatch', 'Sign-in nonce did not match. Start sign-in again.');
    }

    const email = extractEmail(payload as Record<string, unknown>, this.config.emailClaim);
    assertAllowedDomain(email, this.config.allowedDomains);

    return {
      email,
      subject: subjectOf(payload),
      issuer: discovery.issuer,
      displayLabel: typeof payload.name === 'string' ? payload.name : null,
      logoutHint: tokens.id_token,
    };
  }

  async logoutUrl(params: LogoutParams): Promise<string | null> {
    const discovery = await this.discover();
    if (!discovery.end_session_endpoint) return null;
    const url = new URL(discovery.end_session_endpoint);
    url.searchParams.set(
      'post_logout_redirect_uri',
      this.config.postLogoutRedirectUri ?? params.postLogoutRedirectUri,
    );
    if (params.logoutHint) url.searchParams.set('id_token_hint', params.logoutHint);
    return url.toString();
  }
}

function subjectOf(payload: JWTPayload): string {
  const oid = (payload as Record<string, unknown>)['oid'];
  if (typeof oid === 'string') return oid;
  if (typeof payload.sub === 'string') return payload.sub;
  throw new AuthError('entra_no_subject', 'id_token did not include a subject claim.');
}
