import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { localAuthRepo } from '@protocols/db';
import { LocalAuthAdapter } from '../../apps/web/src/server/auth/local.ts';

describe('local password hashing', () => {
  test('salts hashes and verifies exact passwords', async () => {
    const password = 'a-long-local-password';
    const first = await localAuthRepo.hashPassword(password);
    const second = await localAuthRepo.hashPassword(password);
    assert.notEqual(first, second);
    assert.ok(!first.includes(password));
    assert.equal(await localAuthRepo.verifyPassword(password, first), true);
    assert.equal(await localAuthRepo.verifyPassword(password + ' ', first), false);
    assert.equal(await localAuthRepo.verifyPassword(password, 'invalid'), false);
  });
  test('rejects short or oversized passwords', async () => {
    await assert.rejects(localAuthRepo.hashPassword('short'));
    await assert.rejects(localAuthRepo.hashPassword('a'.repeat(1025)));
    assert.equal(await localAuthRepo.verifyPassword('a'.repeat(1025), 'invalid'), false);
  });
  test('uses a base-path-aware login URL without putting credentials in URLs', async () => {
    const adapter = new LocalAuthAdapter([]);
    assert.equal(adapter.isMock, false);
    const started = await adapter.startLogin({ callbackUrl: 'https://host:8444/protocols/auth/callback', returnTo: '/protocols/reports' });
    const url = new URL(started.redirectUrl);
    assert.equal(url.pathname, '/protocols/auth/local');
    assert.equal(url.port, '8444');
    assert.equal(url.searchParams.get('returnTo'), '/protocols/reports');
  });
});
