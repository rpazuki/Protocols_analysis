import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminsRepo, agreementsRepo, auditRepo, getPool } from '@protocols/db';
import { AGREEMENT_VERSION, DomainError } from '@protocols/domain';
import { ADMIN, OWNER, setupDatabase, skipWithoutDatabase, teardownDatabase } from '../helpers/db.ts';

describe('admin allowlist repository', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('config bootstrap creates the allowlist and marks entries as config-sourced', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    const admins = await adminsRepo.listAdmins();
    assert.equal(admins.length, 1);
    assert.equal(admins[0]!.email, ADMIN);
    assert.equal(admins[0]!.fromConfig, true);
  });

  test('config bootstrap is idempotent across restarts', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    await adminsRepo.syncConfigAdmins([ADMIN]);
    assert.equal((await adminsRepo.listAdmins()).length, 1);
  });

  test('config bootstrap reinstates an admin removed in the app - the break-glass path', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    await adminsRepo.addAdmin(OWNER, ADMIN);
    // Force-remove the config admin directly, simulating a bad in-app state.
    await getPool().query(
      'UPDATE admin_allowlist SET removed_at = now(), removed_by = $2 WHERE email = $1',
      [ADMIN, OWNER],
    );
    assert.equal(await adminsRepo.isActiveAdmin(ADMIN), false);

    await adminsRepo.syncConfigAdmins([ADMIN]);
    assert.equal(await adminsRepo.isActiveAdmin(ADMIN), true);
  });

  test('an admin dropped from config is kept as a normal admin, not silently revoked', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN, OWNER]);
    await adminsRepo.syncConfigAdmins([ADMIN]);

    const admins = await adminsRepo.listAdmins();
    const owner = admins.find((a) => a.email === OWNER);
    assert.ok(owner, 'owner should still be an admin');
    assert.equal(owner.fromConfig, false);
  });

  test('emails are normalized to lowercase', async () => {
    await adminsRepo.syncConfigAdmins(['Admin@IC.AC.UK']);
    assert.ok(await adminsRepo.isActiveAdmin('ADMIN@ic.ac.uk'));
  });

  test('the last admin cannot be removed', async () => {
    await adminsRepo.addAdmin(OWNER, 'seed');
    await assert.rejects(
      () => adminsRepo.removeAdmin(OWNER, OWNER),
      (err: unknown) => err instanceof DomainError && err.code === 'last_admin_protected',
    );
  });

  test('a config admin cannot be removed through the app', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    await adminsRepo.addAdmin(OWNER, ADMIN);
    await assert.rejects(
      () => adminsRepo.removeAdmin(ADMIN, OWNER),
      (err: unknown) => err instanceof DomainError && err.code === 'last_admin_protected',
    );
  });

  test('removal is a soft delete that keeps who removed whom', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    await adminsRepo.addAdmin(OWNER, ADMIN);
    const removed = await adminsRepo.removeAdmin(OWNER, ADMIN);

    assert.ok(removed.removedAt);
    assert.equal(removed.removedBy, ADMIN);
    assert.equal(await adminsRepo.isActiveAdmin(OWNER), false);
    assert.equal((await adminsRepo.listAdmins({ includeRemoved: true })).length, 2);
  });

  test('re-adding a removed admin clears the removal', async () => {
    await adminsRepo.syncConfigAdmins([ADMIN]);
    await adminsRepo.addAdmin(OWNER, ADMIN);
    await adminsRepo.removeAdmin(OWNER, ADMIN);
    const readded = await adminsRepo.addAdmin(OWNER, ADMIN);

    assert.equal(readded.removedAt, null);
    assert.ok(await adminsRepo.isActiveAdmin(OWNER));
  });
});

describe('agreement acceptance repository', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('a new user has not accepted the current version', async () => {
    assert.equal(await agreementsRepo.hasAcceptedCurrentAgreement(OWNER), false);
  });

  test('acceptance is recorded and recognised', async () => {
    const acceptance = await agreementsRepo.recordAcceptance(OWNER, 'test');
    assert.equal(acceptance.agreementVersion, AGREEMENT_VERSION);
    assert.ok(await agreementsRepo.hasAcceptedCurrentAgreement(OWNER));
  });

  test('re-accepting does not create a second row or move the original timestamp', async () => {
    const first = await agreementsRepo.recordAcceptance(OWNER, 'test');
    const second = await agreementsRepo.recordAcceptance(OWNER, 'test-again');
    assert.equal(first.acceptedAt, second.acceptedAt);
    assert.equal((await agreementsRepo.listAcceptances(OWNER)).length, 1);
  });

  test('accepting an older version does not satisfy the current one', async () => {
    await getPool().query(
      `INSERT INTO user_agreement_acceptances (researcher_email, agreement_version)
       VALUES ($1, '2020-01-01.1')`,
      [OWNER],
    );
    assert.equal(await agreementsRepo.hasAcceptedCurrentAgreement(OWNER), false);
  });
});

describe('audit repository', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('records an event with sanitized metadata', async () => {
    await auditRepo.recordAuditEvent({
      actorEmail: 'Admin@IC.AC.UK',
      action: 'export.run',
      targetType: 'export',
      targetId: 'file.csv',
      metadata: { rows: 12, nested: { dropped: true } },
    });

    const { events, total } = await auditRepo.listAuditEvents({ page: 1, pageSize: 10 });
    assert.equal(total, 1);
    assert.equal(events[0]!.actorEmail, 'admin@ic.ac.uk');
    assert.equal(events[0]!.metadata.rows, 12);
    assert.ok(!('nested' in events[0]!.metadata));
  });

  test('filters by actor and action', async () => {
    await auditRepo.recordAuditEvent({ actorEmail: OWNER, action: 'report.create', targetType: 'protocol_report' });
    await auditRepo.recordAuditEvent({ actorEmail: ADMIN, action: 'export.run', targetType: 'export' });

    const byActor = await auditRepo.listAuditEvents({ actorEmail: OWNER, page: 1, pageSize: 10 });
    assert.equal(byActor.total, 1);

    const byAction = await auditRepo.listAuditEvents({ action: 'export.run', page: 1, pageSize: 10 });
    assert.equal(byAction.total, 1);
  });
});
