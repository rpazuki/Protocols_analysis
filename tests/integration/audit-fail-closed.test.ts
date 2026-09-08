import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminsRepo,
  agreementsRepo,
  auditRepo,
  denylistRepo,
  getPool,
  protocolTypesRepo,
  reportsRepo,
  withTransaction,
} from '@protocols/db';
import { parseReportFilters } from '@protocols/domain';
import {
  ADMIN,
  OWNER,
  TYPE_TRANSFECTION,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
} from '../helpers/db.ts';

/**
 * Required audit events must fail closed.
 *
 * The web actions wrap each accountability-critical mutation and its audit
 * event in one transaction. These tests simulate the audit write failing and
 * assert that the mutation is rolled back with it, so the app can never report
 * success for a change nobody can later account for.
 *
 * The failure is simulated the way it would actually happen in production: the
 * audit INSERT itself errors (a broken constraint, a revoked grant, a full
 * disk), inside the caller's transaction.
 */

const base = {
  reportDate: '2026-08-30',
  protocolTypeId: TYPE_TRANSFECTION,
  protocolTypeLabelSnapshot: 'Transfection',
  protocolName: 'Ratio 1:2',
  descriptionText: 'Swapped reagent A for reagent B.',
  outcome: 'success' as const,
  outcomeHypothesis: null,
};

/** Makes the next audit INSERT in this transaction fail, then restores it. */
async function failingAudit(client: Parameters<Parameters<typeof withTransaction>[0]>[0]): Promise<void> {
  await client.query(
    `ALTER TABLE audit_events ADD CONSTRAINT audit_events_forced_failure CHECK (false) NOT VALID`,
  );
}

describe('required audit events fail closed', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('a report insert rolls back when its audit event cannot be written', async () => {
    await assert.rejects(
      withTransaction(async (client) => {
        await reportsRepo.createReport({ ...base, researcherEmail: OWNER }, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: OWNER, action: 'report.create', targetType: 'protocol_report' },
          client,
        );
      }),
    );

    // The report must not survive the failed audit.
    const after = await reportsRepo.listReports(parseReportFilters({}), OWNER);
    assert.equal(after.total, 0);
  });

  test('an admin grant rolls back when its audit event cannot be written', async () => {
    await adminsRepo.addAdmin(ADMIN, 'seed');

    await assert.rejects(
      withTransaction(async (client) => {
        await adminsRepo.addAdmin(OWNER, ADMIN, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: ADMIN, action: 'admin.add', targetType: 'admin_allowlist', targetId: OWNER },
          client,
        );
      }),
    );

    // An unaudited admin grant is exactly the change nobody could account for.
    assert.equal(await adminsRepo.isActiveAdmin(OWNER), false);
  });

  test('an admin removal rolls back when its audit event cannot be written', async () => {
    await adminsRepo.addAdmin(ADMIN, 'seed');
    await adminsRepo.addAdmin(OWNER, ADMIN);

    await assert.rejects(
      withTransaction(async (client) => {
        await adminsRepo.removeAdmin(OWNER, ADMIN, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: ADMIN, action: 'admin.remove', targetType: 'admin_allowlist', targetId: OWNER },
          client,
        );
      }),
    );

    assert.equal(await adminsRepo.isActiveAdmin(OWNER), true);
  });

  test('a protocol type change rolls back when its audit event cannot be written', async () => {
    await assert.rejects(
      withTransaction(async (client) => {
        await protocolTypesRepo.updateProtocolType(TYPE_TRANSFECTION, { label: 'Renamed' }, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: ADMIN, action: 'protocol_type.update', targetType: 'protocol_type' },
          client,
        );
      }),
    );

    const type = await protocolTypesRepo.getProtocolType(TYPE_TRANSFECTION);
    assert.equal(type?.label, 'Transfection');
  });

  test('a recycle rolls back when its audit event cannot be written', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });

    await assert.rejects(
      withTransaction(async (client) => {
        await reportsRepo.recycleReport(report.id, OWNER, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: OWNER, action: 'report.recycle', targetType: 'protocol_report' },
          client,
        );
      }),
    );

    const reloaded = await reportsRepo.getReport(report.id);
    assert.equal(reloaded?.deletedAt, null);
  });

  test('a permanent delete rolls back when its audit event cannot be written', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    await reportsRepo.recycleReport(report.id, OWNER);

    await assert.rejects(
      withTransaction(async (client) => {
        await client.query('DELETE FROM protocol_reports WHERE id = $1', [report.id]);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: ADMIN, action: 'report.permanent_delete', targetType: 'protocol_report' },
          client,
        );
      }),
    );

    // An untraceable permanent deletion would defeat the whole point of the
    // tombstone-plus-audit design.
    assert.ok(await reportsRepo.getReport(report.id));
  });

  test('an access block rolls back when its audit event cannot be written', async () => {
    await assert.rejects(
      withTransaction(async (client) => {
        await denylistRepo.denyAccess(OWNER, 'Left the lab', ADMIN, client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: ADMIN, action: 'access.deny', targetType: 'researcher_denylist' },
          client,
        );
      }),
    );

    assert.equal(await denylistRepo.isDenied(OWNER), false);
  });

  test('an agreement acceptance rolls back when its audit event cannot be written', async () => {
    await assert.rejects(
      withTransaction(async (client) => {
        await agreementsRepo.recordAcceptance(OWNER, 'test', client);
        await failingAudit(client);
        await auditRepo.recordAuditEvent(
          { actorEmail: OWNER, action: 'agreement.accept', targetType: 'user_agreement' },
          client,
        );
      }),
    );

    assert.equal(await agreementsRepo.hasAcceptedCurrentAgreement(OWNER), false);
  });

  test('a successful mutation keeps both the change and its audit event', async () => {
    const report = await withTransaction(async (client) => {
      const created = await reportsRepo.createReport({ ...base, researcherEmail: OWNER }, client);
      await auditRepo.recordAuditEvent(
        {
          actorEmail: OWNER,
          action: 'report.create',
          targetType: 'protocol_report',
          targetId: created.id,
        },
        client,
      );
      return created;
    });

    assert.ok(await reportsRepo.getReport(report.id));
    const events = await auditRepo.listAuditEvents({ targetId: report.id, page: 1, pageSize: 10 });
    assert.equal(events.total, 1);
  });

  test('the forced-failure constraint does not leak between tests', async () => {
    const constraints = await getPool().query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_forced_failure'`,
    );
    assert.equal(constraints.rowCount, 0);
  });
});
