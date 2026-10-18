/** Real production server and real database; no SSO service or mocked password checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { localAuthRepo } from '@protocols/db';
import { repoRoot, setupDatabase, teardownDatabase, testDatabaseUrl } from '../helpers/db.ts';

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url: string, server: ReturnType<typeof spawn>, logs: () => string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs()}`);
    try { if ((await fetch(url)).ok) return; } catch { /* Not listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Production server did not become ready: ${logs()}`);
}

test('local login works in a real production build', { timeout: 60000 }, async () => {
  assert.ok(testDatabaseUrl, 'TEST_DATABASE_URL must name a disposable PostgreSQL database.');
  await setupDatabase();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const publicBase = `https://127.0.0.1:${port}`;
  const email = 'production-local@ic.ac.uk';
  const password = 'production-test-password';
  await localAuthRepo.setPassword(email, password, true);
  let logs = '';
  const server = spawn(process.execPath, [path.join(repoRoot, 'apps/web/.next/standalone/apps/web/server.js')], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'production', NEXT_PHASE: '', AUTH_ADAPTER: 'local',
      APP_URL: `${publicBase}/protocols`, PORT: String(port), HOSTNAME: '127.0.0.1',
      SESSION_SECRET: 'production-test-session-secret-at-least-48-characters',
      ADMIN_BOOTSTRAP_EMAILS: email, DATABASE_URL: testDatabaseUrl,
      ENTRA_CLIENT_SECRET: '', SHIBBOLETH_PROXY_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', data => { logs += String(data); });
  server.stderr?.on('data', data => { logs += String(data); });
  try {
    await waitForServer(`${base}/protocols/api/health`, server, () => logs);
    const health = await (await fetch(`${base}/protocols/api/health`)).json();
    assert.equal(health.authAdapter, 'local');

    async function login(value: string, origin = publicBase, returnTo = '/reports') {
      const page = await fetch(`${base}/protocols/auth/local`);
      const html = await page.text();
      assert.equal(page.status, 200);
      const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
      assert.ok(action, 'Local login must render a server-action form.');
      const body = new FormData();
      body.set(action, ''); body.set('email', email); body.set('password', value);
      body.set('returnTo', returnTo);
      return fetch(`${base}/protocols/auth/local`, { method: 'POST', body,
        headers: { origin }, redirect: 'manual' });
    }

    const wrong = await login('wrong-password');
    assert.equal(wrong.status, 303);
    assert.match(wrong.headers.get('location') ?? '', /auth\/local\?.*error=/);
    assert.ok(!wrong.headers.getSetCookie().some(value => value.startsWith('protocols_session=')));

    const foreign = await login(password, 'https://foreign.example');
    assert.ok(foreign.status >= 400);
    assert.ok(!foreign.headers.getSetCookie().some(value => value.startsWith('protocols_session=')));

    const good = await login(password, publicBase, '/protocols/reports');
    assert.equal(good.status, 303);
    assert.equal(good.headers.get('location'), `${publicBase}/protocols/reports`);
    const cookie = good.headers.getSetCookie().find(value => value.startsWith('protocols_session='));
    assert.ok(cookie); assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/);
    const headers = { cookie: cookie.split(';')[0]! };
    const authenticated = await fetch(`${base}/protocols/auth/local`, { headers, redirect: 'manual' });
    assert.equal(authenticated.status, 307);
    assert.equal((await fetch(`${base}/protocols/auth/mock`)).status, 404);
    assert.equal((await fetch(`${base}/protocols/auth/callback`)).status, 404);

    await localAuthRepo.setPassword(email, 'production-replacement-password', false);
    const expired = await fetch(`${base}/protocols/auth/local`, { headers, redirect: 'manual' });
    assert.equal(expired.status, 200, 'An old cookie must not authenticate after a password reset.');
    const updated = await login('production-replacement-password');
    assert.equal(updated.headers.get('location'), `${publicBase}/protocols/reports`);
  } finally {
    server.kill('SIGTERM');
    if (server.exitCode === null) await once(server, 'exit');
    await teardownDatabase();
  }
});
