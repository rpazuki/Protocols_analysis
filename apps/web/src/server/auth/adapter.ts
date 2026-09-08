import 'server-only';
import type { AuthAdapter } from '@protocols/auth-core';
import { MockAuthAdapter } from '@protocols/auth-mock';
import { EntraOidcAdapter } from '@protocols/auth-entra-oidc';
import { ShibbolethSamlAdapter } from '@protocols/auth-shibboleth-saml';
import { config, isProduction } from '../config.ts';

/**
 * Selects the auth adapter for this deployment. This is the only place in the
 * app that knows which identity provider is in use; everything downstream
 * consumes normalized AuthClaims.
 */
let cached: AuthAdapter | null = null;

export function getAuthAdapter(): AuthAdapter {
  if (cached) return cached;

  switch (config.adapterId) {
    case 'mock': {
      if (isProduction) {
        throw new Error('Mock auth cannot be used in production.');
      }
      cached = new MockAuthAdapter({
        allowedDomains: config.allowedEmailDomains,
        allowArbitraryEmail: true,
      });
      break;
    }
    case 'entra-oidc': {
      cached = new EntraOidcAdapter({
        issuer: config.entra.issuer,
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        redirectUri: config.entra.redirectUri,
        postLogoutRedirectUri: config.entra.postLogoutRedirectUri,
        scopes: config.entra.scopes,
        emailClaim: config.entra.emailClaim,
        allowedDomains: config.allowedEmailDomains,
      });
      break;
    }
    case 'shibboleth-saml': {
      cached = new ShibbolethSamlAdapter({
        emailHeader: config.shibboleth.emailHeader,
        sessionHeader: config.shibboleth.sessionHeader,
        displayNameHeader: config.shibboleth.displayNameHeader,
        subjectHeader: config.shibboleth.subjectHeader,
        idpEntityId: config.shibboleth.idpEntityId,
        loginPath: config.shibboleth.loginPath,
        logoutPath: config.shibboleth.logoutPath,
        trustedProxyHeaderSecret: config.shibboleth.proxySecret,
        trustedProxyHeaderName: config.shibboleth.proxyHeaderName,
        allowedDomains: config.allowedEmailDomains,
      });
      break;
    }
    default:
      throw new Error(`Unknown AUTH_ADAPTER "${config.adapterId}".`);
  }

  return cached;
}
