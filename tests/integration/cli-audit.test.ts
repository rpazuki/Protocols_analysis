import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { adminsRepo, auditRepo, denylistRepo, getPool } from '@protocols/db';
import {
  ADMIN,
  OWNER,
  repoRoot,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
  testDatabaseUrl,
} from '../helpers/db.ts';

/**
 * The VM-level CLI is the break-glass path, used exactly when the web app
 * cannot be trusted or reached. Its admin and access changes must therefore
 * carry the same fail-closed audit guarantee as the web actions: a break-glass
 * admin grant that committed without an audit row would be the change nobody
 * could account for afterwards.
 *
 * These run the real script as a child process against a database whose
 * audit_events table rejects every insert, which is how a revoked grant or a
 * broken constraint would present in production.
 */

const execFileAsync = promisify(execFile);
const CLI = path.join(repoRoot, 'scripts', 'admin', 'admin-cli.ts');

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--experimental-strip-types', CLI, ...args],
      { cwd: repoRoot, env: { ...process.env, DATABASE_URL: testDatabaseUrl ?? '' }, encoding: 'utf8' },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Makes every audit insert fail, for the duration of one test. */
async function breakAuditTable(): Promise<void> {
  await getPool().query(
    `ALTER TABLE audit_events ADD CONSTRAINT audit_events_forced_failure CHECK (false) NOT VALID`,
  );
}

async function repairAuditTable(): Promise<void> {
  await getPool().query(
    `ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_forced_failure`,
  );
}

describe('CLI admin changes fail closed', { skip: skipWithoutDatabase }, () => {
  beforeEach(async () => {
    await repairAuditTable();
    await setupDatabase();
  });
  after(async () => {
    await repairAuditTable();
    await teardownDatabase();
  });

  test('a successful add writes both the admin row and its audit event', async () => {
    const result = await runCli(['add', OWNER]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await adminsRepo.isActiveAdmin(OWNER), true);

    const events = await auditRepo.listAuditEvents({ action: 'admin.add', page: 1, pageSize: 10 });
    assert.equal(events.total, 1);
    assert.equal(events.events[0]!.metadata.via, 'cli');
  });

  test('add rolls back the admin grant when the audit event cannot be written', async () => {
    await breakAuditTable();

    const result = await runCli(['add', OWNER]);
    assert.notEqual(result.code, 0, 'the CLI should exit non-zero when the audit write fails');

    await repairAuditTable();
    assert.equal(
      await adminsRepo.isActiveAdmin(OWNER),
      false,
      'an unaudited break-glass admin grant must not persist',
    );
  });

  test('remove rolls back the revocation when the audit event cannot be written', async () => {
    await adminsRepo.addAdmin(ADMIN, 'seed');
    await adminsRepo.addAdmin(OWNER, ADMIN);
    await breakAuditTable();

    const result = await runCli(['remove', OWNER]);
    assert.notEqual(result.code, 0);

    await repairAuditTable();
    assert.equal(await adminsRepo.isActiveAdmin(OWNER), true);
  });

  test('access block rolls back when the audit event cannot be written', async () => {
    await breakAuditTable();

    const result = await runCli(['access', 'block', OWNER]);
    assert.notEqual(result.code, 0);

    await repairAuditTable();
    assert.equal(await denylistRepo.isDenied(OWNER), false);
  });

  test('access unblock rolls back when the audit event cannot be written', async () => {
    await denylistRepo.denyAccess(OWNER, 'Left the lab', ADMIN);
    await breakAuditTable();

    const result = await runCli(['access', 'unblock', OWNER]);
    assert.notEqual(result.code, 0);

    await repairAuditTable();
    assert.equal(await denylistRepo.isDenied(OWNER), true);
  });

  test('the last-admin guard still applies through the CLI', async () => {
    await adminsRepo.addAdmin(OWNER, 'seed');
    const result = await runCli(['remove', OWNER]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /last remaining admin/i);
    assert.equal(await adminsRepo.isActiveAdmin(OWNER), true);
  });
});
