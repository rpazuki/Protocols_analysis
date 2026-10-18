import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { AuthError, assertAllowedDomain, extractEmail } from '@protocols/auth-core';
import { MockAuthAdapter } from '@protocols/auth-mock';
import { ShibbolethSamlAdapter } from '@protocols/auth-shibboleth-saml';
import { repoRoot } from '../helpers/db.ts';

/**
 * Auth boundary properties. These need no database: they are about what the
 * adapters will and will not accept as a trusted identity.
 */

describe('security: mock auth cannot run in production', () => {
  /**
   * Runs the web app's config module in a child process with a production
   * environment, and asserts it refuses to load. This is the guard from
   * docs/ict-sso/identity-integration.md.
   */
  function loadConfigWith(env: Record<string, string>): { ok: boolean; stderr: string } {
    try {
      execFileSync(
        process.execPath,
        [
          '--experimental-strip-types',
          // config.ts imports 'server-only', which resolves to a no-op module
          // only under the react-server condition Next applies to server code.
          '--conditions=react-server',
          '-e',
          "import('./apps/web/src/server/config.ts').then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })",
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, ...env },
          stdio: ['ignore', 'ignore', 'pipe'],
          encoding: 'utf8',
        },
      );
      return { ok: true, stderr: '' };
    } catch (err) {
      const e = err as { stderr?: string };
      return { ok: false, stderr: e.stderr ?? '' };
    }
  }

  const productionBase = {
    NODE_ENV: 'production',
    NEXT_PHASE: '',
    APP_URL: 'https://protocols.lab.example.ac.uk',
    SESSION_SECRET: 'a'.repeat(48),
    ADMIN_BOOTSTRAP_EMAILS: 'admin@ic.ac.uk',
    DATABASE_URL: 'postgres://unused',
  };

  test('refuses to load with AUTH_ADAPTER=mock', () => {
    const result = loadConfigWith({ ...productionBase, AUTH_ADAPTER: 'mock' });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /mock is not allowed with NODE_ENV=production/);
  });

  test('accepts local password login in production without SSO secrets', () => {
    const result = loadConfigWith({ ...productionBase, AUTH_ADAPTER: 'local',
      ENTRA_CLIENT_SECRET: '', SHIBBOLETH_PROXY_SECRET: '' });
    assert.equal(result.ok, true, result.stderr);
  });

  test('refuses an unknown production adapter', () => {
    const result = loadConfigWith({ ...productionBase, AUTH_ADAPTER: 'unknown' });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /Unknown AUTH_ADAPTER/);
  });

  test('refuses a short session secret', () => {
    const result = loadConfigWith({
      ...productionBase,
      AUTH_ADAPTER: 'shibboleth-saml',
      SHIBBOLETH_PROXY_SECRET: 'x'.repeat(32),
      SESSION_SECRET: 'too-short',
    });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /SESSION_SECRET must be at least 32 characters/);
  });

  test('refuses a non-https APP_URL, because session cookies are Secure-only', () => {
    const result = loadConfigWith({
      ...productionBase,
      AUTH_ADAPTER: 'shibboleth-saml',
      SHIBBOLETH_PROXY_SECRET: 'x'.repeat(32),
      APP_URL: 'http://protocols.lab.example.ac.uk',
    });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /APP_URL must be an https:\/\/ URL/);
  });

  test('refuses to start with no bootstrap admin', () => {
    const result = loadConfigWith({
      ...productionBase,
      AUTH_ADAPTER: 'shibboleth-saml',
      SHIBBOLETH_PROXY_SECRET: 'x'.repeat(32),
      ADMIN_BOOTSTRAP_EMAILS: '',
    });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /ADMIN_BOOTSTRAP_EMAILS must list at least one admin/);
  });

  test('accepts a complete production configuration', () => {
    const result = loadConfigWith({
      ...productionBase,
      AUTH_ADAPTER: 'shibboleth-saml',
      SHIBBOLETH_PROXY_SECRET: 'x'.repeat(32),
    });
    assert.equal(result.ok, true, result.stderr);
  });

  test('the development build still loads with mock auth', () => {
    const result = loadConfigWith({
      NODE_ENV: 'development',
      NEXT_PHASE: '',
      AUTH_ADAPTER: 'mock',
      APP_URL: 'http://localhost:3000',
      SESSION_SECRET: '',
      ADMIN_BOOTSTRAP_EMAILS: '',
      DATABASE_URL: 'postgres://unused',
    });
    assert.equal(result.ok, true, result.stderr);
  });
});

describe('security: identity is never taken from untrusted input', () => {
  test('the mock adapter refuses to mint a session without a persona or email', async () => {
    const adapter = new MockAuthAdapter();
    await assert.rejects(
      () =>
        adapter.completeLogin({
          requestUrl: 'http://localhost:3000/auth/mock',
          headers: new Headers(),
          body: {},
          transaction: {},
        }),
      AuthError,
    );
  });

  test('the Shibboleth adapter rejects forged attribute headers without the proxy secret', async () => {
    const adapter = new ShibbolethSamlAdapter({ trustedProxyHeaderSecret: 'shared-secret' });

    const forged = new Headers({
      mail: 'attacker@ic.ac.uk',
      'shib-session-id': 'made-up',
    });
    await assert.rejects(
      () =>
        adapter.completeLogin({
          requestUrl: 'https://app.example.ac.uk/auth/callback',
          headers: forged,
          transaction: {},
        }),
      (err: unknown) => err instanceof AuthError && err.code === 'shibboleth_untrusted_request',
    );
  });

  test('the Shibboleth adapter rejects a proxied request with no SP session', async () => {
    const adapter = new ShibbolethSamlAdapter({ trustedProxyHeaderSecret: 'shared-secret' });

    const headers = new Headers({
      'x-sp-proxy-secret': 'shared-secret',
      mail: 'someone@ic.ac.uk',
    });
    await assert.rejects(
      () =>
        adapter.completeLogin({
          requestUrl: 'https://app.example.ac.uk/auth/callback',
          headers,
          transaction: {},
        }),
      (err: unknown) => err instanceof AuthError && err.code === 'shibboleth_no_session',
    );
  });

  test('the Shibboleth adapter accepts a properly proxied request', async () => {
    const adapter = new ShibbolethSamlAdapter({ trustedProxyHeaderSecret: 'shared-secret' });

    const headers = new Headers({
      'x-sp-proxy-secret': 'shared-secret',
      'shib-session-id': '_abc123',
      mail: 'Someone%40ic.ac.uk'.replace('%40', '@'),
      'persistent-id': 'idp!sp!opaque',
    });
    const claims = await adapter.completeLogin({
      requestUrl: 'https://app.example.ac.uk/auth/callback',
      headers,
      transaction: {},
    });
    assert.equal(claims.email, 'someone@ic.ac.uk');
    assert.equal(claims.subject, 'idp!sp!opaque');
  });

  test('the adapter refuses to construct without a proxy secret', () => {
    assert.throws(
      () => new ShibbolethSamlAdapter({ trustedProxyHeaderSecret: '' }),
      (err: unknown) => err instanceof AuthError && err.code === 'shibboleth_config_incomplete',
    );
  });
});

describe('security: claim extraction', () => {
  test('throws rather than guessing when no email claim is released', () => {
    assert.throws(
      () => extractEmail({ sub: 'abc', name: 'A Person' }),
      (err: unknown) => err instanceof AuthError && err.code === 'missing_email_claim',
    );
  });

  test('prefers the configured claim and normalizes the result', () => {
    assert.equal(
      extractEmail({ upn: 'Person@IC.AC.UK', email: 'other@ic.ac.uk' }, 'upn'),
      'person@ic.ac.uk',
    );
  });

  test('the domain guard refuses an out-of-tenant address', () => {
    assert.throws(
      () => assertAllowedDomain('someone@gmail.com', ['ic.ac.uk', 'imperial.ac.uk']),
      (err: unknown) => err instanceof AuthError && err.code === 'domain_not_allowed',
    );
    assert.doesNotThrow(() => assertAllowedDomain('someone@ic.ac.uk', ['ic.ac.uk']));
    // Subdomains of an approved domain are accepted.
    assert.doesNotThrow(() => assertAllowedDomain('someone@dept.ic.ac.uk', ['ic.ac.uk']));
  });

  test('an empty allowlist disables the domain guard', () => {
    assert.doesNotThrow(() => assertAllowedDomain('anyone@anywhere.test', []));
  });
});
