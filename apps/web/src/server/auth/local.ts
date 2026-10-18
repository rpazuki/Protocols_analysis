import { AuthError, assertAllowedDomain, type AuthAdapter, type CompleteLoginParams } from '@protocols/auth-core';
import { localAuthRepo } from '@protocols/db';

/** Password verification is entirely server-side; query strings never carry credentials. */
export class LocalAuthAdapter implements AuthAdapter {
  readonly id = 'local' as const;
  readonly isMock = false;
  readonly displayName = 'Sign in with email and password';
  private readonly allowedDomains: string[];
  constructor(allowedDomains: string[]) { this.allowedDomains = allowedDomains; }

  async startLogin(params: { returnTo: string; callbackUrl: string }) {
    const url = new URL('./local', params.callbackUrl);
    url.searchParams.set('returnTo', params.returnTo);
    return { redirectUrl: url.toString(), transaction: { returnTo: params.returnTo } };
  }

  async completeLogin(params: CompleteLoginParams) {
    const email = params.body?.email ?? '';
    const password = params.body?.password ?? '';
    const account = await localAuthRepo.authenticate(email, password);
    if (!account) throw new AuthError('invalid_credentials', 'The email or password is not valid.');
    assertAllowedDomain(account.email, this.allowedDomains);
    return {
      email: account.email,
      subject: `local:${account.email}`,
      issuer: 'local-password',
      credentialVersion: account.version,
    };
  }

  async logoutUrl() { return null; }
}
