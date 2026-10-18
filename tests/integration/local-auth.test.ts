import { describe, test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { localAuthRepo, query, withTransaction } from '@protocols/db';
import { LocalAuthAdapter } from '../../apps/web/src/server/auth/local.ts';
import { setupDatabase, teardownDatabase, skipWithoutDatabase } from '../helpers/db.ts';

const EMAIL = 'local-user@ic.ac.uk';
const PASSWORD = 'a-long-local-password';

describe('local authentication against PostgreSQL', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('requires a provisioned account and an exact password', async () => {
    assert.equal(await localAuthRepo.authenticate(EMAIL, PASSWORD), null);
    await localAuthRepo.setPassword(EMAIL, PASSWORD, true);
    assert.equal(await localAuthRepo.authenticate(EMAIL, 'wrong'), null);
    assert.deepEqual(await localAuthRepo.authenticate(EMAIL.toUpperCase(), PASSWORD), { email: EMAIL, version: 1 });
    const adapter = new LocalAuthAdapter(['ic.ac.uk']);
    const claims = await adapter.completeLogin({ requestUrl: 'https://host/auth/local', headers: new Headers(), transaction: {}, body: { email: EMAIL, password: PASSWORD } });
    assert.equal(claims.issuer, 'local-password');
    assert.equal(claims.credentialVersion, 1);
    await assert.rejects(adapter.completeLogin({ requestUrl: `https://host/auth/local?email=${EMAIL}&password=${PASSWORD}`, headers: new Headers(), transaction: {} }));
    await assert.rejects(new LocalAuthAdapter(['other.example']).completeLogin({ requestUrl: 'https://host/auth/local', headers: new Headers(), transaction: {}, body: { email: EMAIL, password: PASSWORD } }));
  });

  test('does not overwrite an existing account during creation', async () => {
    await localAuthRepo.setPassword(EMAIL, PASSWORD, true);
    await assert.rejects(localAuthRepo.setPassword(EMAIL, 'replacement-password', true));
    assert.ok(await localAuthRepo.authenticate(EMAIL, PASSWORD));
  });

  test('commits lockouts, rejects valid passwords while locked, and expires lockouts', async () => {
    await localAuthRepo.setPassword(EMAIL, PASSWORD, true);
    for (let i = 0; i < 10; i++) assert.equal(await localAuthRepo.authenticate(EMAIL, 'wrong'), null);
    assert.equal(await localAuthRepo.authenticate(EMAIL, PASSWORD), null);
    const row = await query('SELECT failed_login_count, locked_until FROM local_accounts WHERE email=$1', [EMAIL]);
    assert.equal(row.rows[0].failed_login_count, 10);
    assert.ok(row.rows[0].locked_until > new Date());
    await query("UPDATE local_accounts SET locked_until = now() - interval '1 second' WHERE email=$1", [EMAIL]);
    assert.ok(await localAuthRepo.authenticate(EMAIL, PASSWORD));
  });

  test('resets and disabling invalidate existing sessions', async () => {
    await localAuthRepo.setPassword(EMAIL, PASSWORD, true);
    assert.equal(await localAuthRepo.isSessionCurrent(EMAIL, 1), true);
    await localAuthRepo.setPassword(EMAIL, 'replacement-password', false);
    assert.equal(await localAuthRepo.isSessionCurrent(EMAIL, 1), false);
    assert.equal(await localAuthRepo.authenticate(EMAIL, PASSWORD), null);
    assert.ok(await localAuthRepo.authenticate(EMAIL, 'replacement-password'));
    await localAuthRepo.disable(EMAIL);
    assert.equal(await localAuthRepo.isSessionCurrent(EMAIL, 2), false);
    assert.equal(await localAuthRepo.authenticate(EMAIL, 'replacement-password'), null);
  });

  test('the application role cannot create accounts or reset password hashes', async () => {
    await localAuthRepo.setPassword(EMAIL, PASSWORD, true);
    await withTransaction(async client => {
      await client.query('SET LOCAL ROLE protocols_app');
      await client.query('SELECT email FROM local_accounts');
      await client.query('UPDATE local_accounts SET failed_login_count=1 WHERE email=$1', [EMAIL]);
    });
    await assert.rejects(withTransaction(async client => {
      await client.query('SET LOCAL ROLE protocols_app');
      await client.query("UPDATE local_accounts SET password_hash='forged' WHERE email=$1", [EMAIL]);
    }), /permission denied/);
    await assert.rejects(withTransaction(async client => {
      await client.query('SET LOCAL ROLE protocols_app');
      await client.query("INSERT INTO local_accounts (email,password_hash) VALUES ('forged@ic.ac.uk','hash')");
    }), /permission denied/);
  });
});
