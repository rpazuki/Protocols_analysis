/** Real production server and real database; no SSO service or mocked password checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { cpSync, existsSync } from 'node:fs';
import { localAuthRepo, query } from '@protocols/db';
import { repoRoot, setupDatabase, teardownDatabase, testDatabaseUrl } from '../helpers/db.ts';

async function fetch(input: string, init?: RequestInit): Promise<Response> {
  try { return await globalThis.fetch(input,init); }
  catch (cause) { throw new Error(`Request failed for ${input}`, { cause }); }
}

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

test('local login works in a real production build', { timeout: 120000 }, async () => {
  assert.ok(testDatabaseUrl, 'TEST_DATABASE_URL must name a disposable PostgreSQL database.');
  await setupDatabase();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const publicBase = `https://127.0.0.1:${port}`;
  const email = 'production-local@ic.ac.uk';
  const password = 'production-test-password';
  await localAuthRepo.setPassword(email, password, true);
  const appDatabaseUrl = new URL(testDatabaseUrl);
  appDatabaseUrl.searchParams.set('options', '-c role=protocols_app');
  const webRoot = path.join(repoRoot,'apps/web');
  cpSync(path.join(webRoot,'.next/static'),path.join(webRoot,'.next/standalone/apps/web/.next/static'),{recursive:true});
  if (existsSync(path.join(webRoot,'public'))) cpSync(path.join(webRoot,'public'),path.join(webRoot,'.next/standalone/apps/web/public'),{recursive:true});
  let logs = '';
  const server = spawn(process.execPath, [path.join(repoRoot, 'apps/web/.next/standalone/apps/web/server.js')], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'production', NEXT_PHASE: '', AUTH_ADAPTER: 'local',
      APP_URL: `${publicBase}/protocols`, PORT: String(port), HOSTNAME: '127.0.0.1',
      SESSION_SECRET: 'production-test-session-secret-at-least-48-characters',
      ADMIN_BOOTSTRAP_EMAILS: email, DATABASE_URL: appDatabaseUrl.toString(),
      ENTRA_CLIENT_SECRET: '', SHIBBOLETH_PROXY_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', data => { logs += String(data); });
  server.stderr?.on('data', data => { logs += String(data); });
  try {
    await waitForServer(`${base}/protocols/api/health`, server, () => logs);
    const health = await (await fetch(`${base}/protocols/api/health`)).json();
    assert.equal(health.authAdapter, 'local');
    await query('ALTER TABLE local_accounts RENAME COLUMN must_change_password TO test_missing_password_flag');
    try {
      assert.equal((await fetch(`${base}/protocols/api/health`)).status,503,'Missing required local-account schema must fail readiness.');
    } finally {
      await query('ALTER TABLE local_accounts RENAME COLUMN test_missing_password_flag TO must_change_password');
    }
    const anonymous = await fetch(`${base}/protocols/reports`, { redirect: 'manual' });
    assert.equal(anonymous.status, 307);
    const signInLocation = new URL(anonymous.headers.get('location')!, publicBase);
    assert.equal(signInLocation.pathname, '/protocols/auth/signin');
    assert.ok(!signInLocation.pathname.includes('/protocols/protocols/'));


    async function login(value: string, origin = publicBase, returnTo = '/reports', accountEmail = email) {
      const page = await fetch(`${base}/protocols/auth/local`);
      const html = await page.text();
      assert.equal(page.status, 200);
      const action = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
      assert.ok(action, 'Local login must render a server-action form.');
      const body = new FormData();
      body.set(action, ''); body.set('email', accountEmail); body.set('password', value);
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
    assert.equal(authenticated.headers.get('location'), `${publicBase}/protocols/reports`);

    const protectedPage = await fetch(`${base}/protocols/reports`, { headers, redirect: 'manual' });
    assert.equal(protectedPage.status, 307);
    const agreementLocation = new URL(protectedPage.headers.get('location')!, publicBase);
    assert.equal(agreementLocation.pathname, '/protocols/agreement');
    const agreementPage = await fetch(`${base}${agreementLocation.pathname}${agreementLocation.search}`, { headers });
    assert.equal(agreementPage.status, 200);
    const agreementHtml = await agreementPage.text();
    assert.ok(!agreementHtml.match(/patient-identifiable|participant-identifiable/));
    // Submit only the disposable test account's acknowledgement, exercising the real action redirect.
    function actionFormData(html: string): FormData {
      const body = new FormData();
      const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      for (const input of html.matchAll(/<input\b[^>]*>/g)) {
        const attrs = Object.fromEntries([...input[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)]
          .map(match => [match[1]!, decode(match[2]!)]));
        if (attrs.type === 'hidden' && attrs.name) body.append(attrs.name, attrs.value ?? '');
      }
      return body;
    }
    const agreementBody = actionFormData(agreementHtml);
    agreementBody.set('accept', 'yes');
    agreementBody.set('returnTo', '/protocols/reports');
    const accepted = await fetch(`${base}/protocols/agreement`, {
      method: 'POST', body: agreementBody, headers: { ...headers, origin: publicBase }, redirect: 'manual',
    });
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), `${publicBase}/protocols/reports`);
    for (const route of ['/reports', '/reports/new', '/reports/recycle-bin',
      '/admin/reports', '/admin/recycle-bin', '/admin/protocol-types', '/admin/admins', '/admin/users', '/admin/access', '/admin/audit', '/admin/export']) {
      const page = await fetch(`${base}/protocols${route}`, { headers, redirect: 'manual' });
      const html = await page.text();
      assert.equal(page.status, 200, `${route}: ${html.slice(0, 300)}`);
      assert.ok(!html.includes('<h1>Not found</h1>'), route);
      assert.ok(!html.match(/patient-identifiable|participant-identifiable/), route);
    }
    const newReportPage = await fetch(`${base}/protocols/reports/new`, { headers });
    const reportBody = actionFormData(await newReportPage.text());
    const fields = {
      reportDate: '2026-08-30', protocolTypeId: '11111111-1111-1111-1111-111111111111',
      protocolName: 'Production routing test', descriptionText: 'Synthetic biology procedure test.',
      outcome: 'success', outcomeHypothesis: 'Expected experimental result.',
    };
    for (const [key, value] of Object.entries(fields)) reportBody.set(key, value);
    const created = await fetch(`${base}/protocols/reports/new`, {
      method: 'POST', body: reportBody, headers: { ...headers, origin: publicBase }, redirect: 'manual',
    });
    assert.equal(created.status, 303);
    const createdUrl = new URL(created.headers.get('location')!, publicBase);
    assert.match(createdUrl.pathname, /^\/protocols\/reports\/[a-f0-9-]+$/);
    assert.equal(createdUrl.searchParams.get('created'), '1');
    const detail = await fetch(`${base}${createdUrl.pathname}`, { headers });
    assert.equal(detail.status, 200);
    assert.ok((await detail.text()).includes('Production routing test'));

    const editPage = await fetch(`${base}${createdUrl.pathname}/edit`, { headers });
    assert.equal(editPage.status, 200);
    const editBody = actionFormData(await editPage.text());
    for (const [key, value] of Object.entries(fields)) editBody.set(key, value);
    editBody.set('descriptionText', 'Updated synthetic biology procedure test.');
    const edited = await fetch(`${base}${createdUrl.pathname}/edit`, {
      method: 'POST', body: editBody, headers: { ...headers, origin: publicBase }, redirect: 'manual',
    });
    assert.equal(edited.status, 303);
    assert.equal(edited.headers.get('location'), `${publicBase}${createdUrl.pathname}?updated=1`);

    const home = await fetch(`${base}/protocols`, { headers, redirect: 'manual' });
    assert.equal(home.headers.get('location'), `${publicBase}/protocols/reports/new`);
    const adminIndex = await fetch(`${base}/protocols/admin`, { headers, redirect: 'manual' });
    assert.equal(adminIndex.headers.get('location'), `${publicBase}/protocols/admin/reports`);

    assert.equal((await fetch(`${base}/protocols/auth/mock`)).status, 404);
    assert.equal((await fetch(`${base}/protocols/auth/callback`)).status, 404);

    // Exercise user management through the production server, using protocols_app.
    const newEmail = 'new-local@ic.ac.uk';
    async function usersForm(operation: string, target?: string) {
      const page = await fetch(`${base}/protocols/admin/users`, { headers });
      const html = await page.text();
      assert.equal(page.status,200);
      const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match=>match[0]);
      const found = forms.find(form=>form.includes(`value="${operation}"`) && (!target || form.includes(`value="${target}"`)));
      assert.ok(found,`Missing ${operation} form for ${target}`);
      return actionFormData(found);
    }
    async function adminOperation(operation: string, target = newEmail) {
      const body = await usersForm(operation,operation === 'create' ? undefined : target);
      body.set('email',target); body.set('operation',operation);
      if(operation === 'create') body.set('role','researcher');
      const result = await fetch(`${base}/protocols/admin/users`, {method:'POST',body,
        headers:{...headers,origin:publicBase},redirect:'manual'});
      assert.equal(result.status,200);
      return result.text();
    }
    const foreignCreate = await usersForm('create');
    foreignCreate.set('email','foreign-create@ic.ac.uk');
    const foreignAdmin = await fetch(`${base}/protocols/admin/users`, { method:'POST',body:foreignCreate,
      headers:{...headers,origin:'https://foreign.example'},redirect:'manual' });
    assert.ok(foreignAdmin.status >= 400);
    assert.equal((await query("SELECT 1 FROM local_accounts WHERE email='foreign-create@ic.ac.uk'")).rowCount,0);
    const createHtml = await adminOperation('create');
    const temporaryPassword = createHtml.match(/Temporary password:[\s\S]*?<code[^>]*>([^<]+)/)?.[1];
    assert.ok(temporaryPassword,'The creating administrator receives a temporary password.');
    const freshUsers = await (await fetch(`${base}/protocols/admin/users`,{headers})).text();
    assert.ok(!freshUsers.includes(temporaryPassword),'A subsequent GET must not redisplay the password.');
    const tempLogin = await login(temporaryPassword,publicBase,'/reports',newEmail);
    const tempCookie = tempLogin.headers.getSetCookie().find(v=>v.startsWith('protocols_session='))!;
    assert.ok(tempCookie);
    const pendingHeaders = {cookie:tempCookie.split(';')[0]!};
    for(const route of ['/reports','/agreement','/admin/users']) {
      const pending = await fetch(`${base}/protocols${route}`,{headers:pendingHeaders,redirect:'manual'});
      assert.equal(pending.headers.get('location'),`${publicBase}/protocols/auth/change-password`);
    }
    const blockedReport = await fetch(`${base}/protocols/reports/new`,{method:'POST',body:reportBody,
      headers:{...pendingHeaders,origin:publicBase},redirect:'manual'});
    assert.equal(blockedReport.headers.get('location'),`${publicBase}/protocols/auth/change-password`);
    assert.equal((await query('SELECT 1 FROM protocol_reports WHERE researcher_email=$1',[newEmail])).rowCount,0);
    const passwordPage = await fetch(`${base}/protocols/auth/change-password`,{headers:pendingHeaders});
    const passwordHtml = await passwordPage.text();
    assert.equal(passwordPage.status,200);
    assert.match(passwordHtml,/id="new-password"/);
    assert.match(passwordHtml,/id="confirmation"/);
    const styles = [...passwordHtml.matchAll(/href="([^" ]+\.css[^" ]*)"/g)];
    assert.ok(styles.length);
    for(const [,asset] of styles) assert.equal((await fetch(`${base}${asset}`)).status,200);
    async function submitPassword(current: string,newPassword: string,confirmation: string) {
      const body = actionFormData(passwordHtml);
      body.set('currentPassword',current);body.set('newPassword',newPassword);body.set('confirmation',confirmation);
      return fetch(`${base}/protocols/auth/change-password`,{method:'POST',body,
        headers:{...pendingHeaders,origin:publicBase},redirect:'manual'});
    }
    const foreignPasswordBody=actionFormData(passwordHtml);
    foreignPasswordBody.set('currentPassword',temporaryPassword); foreignPasswordBody.set('newPassword','foreign-test-password');
    foreignPasswordBody.set('confirmation','foreign-test-password');
    const foreignChange=await fetch(`${base}/protocols/auth/change-password`,{method:'POST',body:foreignPasswordBody,
      headers:{...pendingHeaders,origin:'https://foreign.example'},redirect:'manual'});
    assert.ok(foreignChange.status >= 400);
    assert.equal((await localAuthRepo.sessionState(newEmail,1))?.mustChangePassword,true);
    const mismatch = await submitPassword(temporaryPassword,'replacement-user-password','different-password');
    assert.match(await mismatch.text(),/passwords do not match/);
    const wrongCurrent = await submitPassword('wrong','replacement-user-password','replacement-user-password');
    assert.match(await wrongCurrent.text(),/current password is not valid/);
    const changed = await submitPassword(temporaryPassword,'replacement-user-password','replacement-user-password');
    assert.equal(changed.status,303);
    const userCookie = changed.headers.getSetCookie().find(v=>v.startsWith('protocols_session='))!;
    assert.ok(userCookie); assert.match(userCookie,/Secure/);
    const userHeaders={cookie:userCookie.split(';')[0]!};
    const replay = await fetch(`${base}/protocols/reports`,{headers:pendingHeaders,redirect:'manual'});
    assert.match(replay.headers.get('location') ?? '',/auth\/signin/);
    // Agreement follows password change, and a researcher cannot invoke admin actions.
    const userAgreement = await fetch(`${base}/protocols/agreement`,{headers:userHeaders});
    const userAgreementBody=actionFormData(await userAgreement.text());
    userAgreementBody.set('accept','yes'); userAgreementBody.set('returnTo','/reports');
    await fetch(`${base}/protocols/agreement`,{method:'POST',body:userAgreementBody,
      headers:{...userHeaders,origin:publicBase},redirect:'manual'});
    const researcherAdminPage=await fetch(`${base}/protocols/admin/users`,{headers:userHeaders,redirect:'manual'});
    assert.match(researcherAdminPage.headers.get('location') ?? '',/no-access/);
    const forged = await usersForm('create');
    forged.set('email','forged@ic.ac.uk');forged.set('role','admin');
    await fetch(`${base}/protocols/admin/users`,{method:'POST',body:forged,headers:{...userHeaders,origin:publicBase},redirect:'manual'});
    assert.equal((await query("SELECT 1 FROM local_accounts WHERE email='forged@ic.ac.uk'")).rowCount,0);
    await adminOperation('promote');
    assert.equal((await query('SELECT 1 FROM admin_allowlist WHERE email=$1 AND removed_at IS NULL',[newEmail])).rowCount,1);
    const resetHtml = await adminOperation('reset');
    const resetPassword=resetHtml.match(/Temporary password:[\s\S]*?<code[^>]*>([^<]+)/)?.[1];
    assert.ok(resetPassword);
    assert.match((await fetch(`${base}/protocols/reports`,{headers:userHeaders,redirect:'manual'})).headers.get('location') ?? '',/auth\/signin/);
    await adminOperation('disable');
    assert.equal(await localAuthRepo.authenticate(newEmail,resetPassword),null);
    await adminOperation('reactivate');
    assert.ok(await localAuthRepo.authenticate(newEmail,resetPassword));
    assert.equal((await localAuthRepo.sessionState(newEmail,5))?.mustChangePassword,true);
    const audit=await query('SELECT metadata FROM audit_events WHERE target_id=$1',[newEmail]);
    assert.ok(!JSON.stringify(audit.rows).includes(temporaryPassword));
    assert.ok(!JSON.stringify(audit.rows).includes(resetPassword));
    assert.ok(!logs.includes(temporaryPassword) && !logs.includes(resetPassword));

    await localAuthRepo.setPassword(email, 'production-replacement-password', false);
    const expired = await fetch(`${base}/protocols/auth/local`, { headers, redirect: 'manual' });
    assert.equal(expired.status, 200, 'An old cookie must not authenticate after a password reset.');
    const updated = await login('production-replacement-password');
    assert.equal(updated.headers.get('location'), `${publicBase}/protocols/reports`);
    const signedOut = await fetch(`${base}/protocols/auth/signout`,{ method:'POST',headers,redirect:'manual' });
    const cleared = signedOut.headers.getSetCookie().find(value=>value.startsWith('protocols_session='));
    assert.ok(cleared); assert.match(cleared,/Path=\/protocols/); assert.match(cleared,/Max-Age=0/);
  } finally {
    server.kill('SIGTERM');
    if (server.exitCode === null) await once(server, 'exit');
    await teardownDatabase();
  }
});
