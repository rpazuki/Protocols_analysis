import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportsRepo, getPool } from '@protocols/db';
import {
  DEFAULT_AUTHZ_POLICY,
  canEditReport,
  canExport,
  canManageAdmins,
  canManageProtocolTypes,
  canPermanentlyDeleteReport,
  canRecycleReport,
  canRestoreReport,
  canViewReport,
  reportFilterSchema,
  type Principal,
} from '@protocols/domain';
import {
  ADMIN,
  OTHER,
  OWNER,
  TYPE_TRANSFECTION,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
} from '../helpers/db.ts';

/**
 * The checks listed in tests/security/README.md, exercised against a real
 * database so that ownership scoping is proven at the query layer and not
 * just in the pure policy functions.
 */

const owner: Principal = { email: OWNER, role: 'researcher', isMock: true };
const intruder: Principal = { email: OTHER, role: 'researcher', isMock: true };
const admin: Principal = { email: ADMIN, role: 'admin', isMock: true };

const base = {
  reportDate: '2026-08-30',
  protocolTypeId: TYPE_TRANSFECTION,
  protocolTypeLabelSnapshot: 'Transfection',
  protocolName: 'Ratio 1:2',
  descriptionText: 'Swapped reagent A for reagent B.',
  outcome: 'success' as const,
  outcomeHypothesis: null,
};

describe('security: report access control', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('a researcher cannot read another researcher’s reports through the listing', async () => {
    await reportsRepo.createReport({ ...base, researcherEmail: OWNER });

    const intruderView = await reportsRepo.listReports(reportFilterSchema.parse({}), intruder.email);
    assert.equal(intruderView.total, 0);
  });

  test('a researcher cannot read another researcher’s report by id', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    const loaded = await reportsRepo.getReport(report.id);
    assert.ok(loaded);
    // The repository is unscoped by design; the guard the pages use must refuse.
    assert.equal(canViewReport(intruder, loaded), false);
    assert.equal(canViewReport(owner, loaded), true);
    assert.equal(canViewReport(admin, loaded), true);
  });

  test('a researcher cannot edit another researcher’s report', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    assert.equal(canEditReport(intruder, report), false);
  });

  test('an admin cannot edit another researcher’s report content either', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    assert.equal(canEditReport(admin, report), false);
  });

  test('a researcher cannot recycle another researcher’s report', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    assert.equal(canRecycleReport(intruder, report), false);
    assert.equal(canRecycleReport(admin, report), true);
  });

  test('a researcher cannot restore another researcher’s recycled report', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    const recycled = await reportsRepo.recycleReport(report.id, OWNER);
    assert.equal(canRestoreReport(intruder, recycled, DEFAULT_AUTHZ_POLICY), false);
    assert.equal(canRestoreReport(owner, recycled, DEFAULT_AUTHZ_POLICY), true);
  });

  test('a researcher cannot permanently delete another researcher’s recycled report', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    const recycled = await reportsRepo.recycleReport(report.id, OWNER);
    assert.equal(canPermanentlyDeleteReport(intruder, recycled, DEFAULT_AUTHZ_POLICY), false);
  });

  test('the recycle bin listing is also owner-scoped', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    await reportsRepo.recycleReport(report.id, OWNER);

    const intruderBin = await reportsRepo.listReports(
      reportFilterSchema.parse({ state: 'recycled' }),
      intruder.email,
    );
    assert.equal(intruderBin.total, 0);

    const adminBin = await reportsRepo.listReports(reportFilterSchema.parse({ state: 'recycled' }));
    assert.equal(adminBin.total, 1);
  });

  test('an explicit researcherEmail filter cannot widen an owner-scoped listing', async () => {
    await reportsRepo.createReport({ ...base, researcherEmail: OWNER });

    // The owner scope is applied on top of the filter, so an intruder passing
    // the owner's address as a filter still sees nothing.
    const attempt = await reportsRepo.listReports(
      reportFilterSchema.parse({ researcherEmail: OWNER }),
      intruder.email,
    );
    assert.equal(attempt.total, 0);
  });
});

describe('security: admin-only capabilities', { skip: skipWithoutDatabase }, () => {
  test('non-admins cannot export, manage types, or manage admins', () => {
    assert.equal(canExport(owner), false);
    assert.equal(canManageProtocolTypes(owner), false);
    assert.equal(canManageAdmins(owner), false);
  });

  test('admins can', () => {
    assert.equal(canExport(admin), true);
    assert.equal(canManageProtocolTypes(admin), true);
    assert.equal(canManageAdmins(admin), true);
  });
});

describe('security: database-level guarantees', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('the duplicate rule is enforced by a unique index, not only by app code', async () => {
    await reportsRepo.createReport({ ...base, researcherEmail: OWNER });

    // Bypass the repository entirely, as a raw SQL client or a future
    // background job would.
    await assert.rejects(
      () =>
        getPool().query(
          `INSERT INTO protocol_reports
             (report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
              protocol_name, description_text, outcome)
           VALUES ($1, $2, $3, 'Transfection', 'Different name', $4, 'failure')`,
          [base.reportDate, OWNER, TYPE_TRANSFECTION, base.descriptionText],
        ),
      (err: unknown) => (err as { code?: string }).code === '23505',
    );
  });

  test('the database rejects a mixed-case researcher email', async () => {
    await assert.rejects(
      () =>
        getPool().query(
          `INSERT INTO protocol_reports
             (report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
              protocol_name, description_text, outcome)
           VALUES ('2026-08-30', 'Mixed.Case@ic.ac.uk', $1, 'Transfection', 'n', 'd', 'success')`,
          [TYPE_TRANSFECTION],
        ),
      (err: unknown) => (err as { constraint?: string }).constraint === 'protocol_reports_email_lower',
    );
  });

  test('the database rejects an outcome outside success/failure', async () => {
    await assert.rejects(
      () =>
        getPool().query(
          `INSERT INTO protocol_reports
             (report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
              protocol_name, description_text, outcome)
           VALUES ('2026-08-30', 'x@ic.ac.uk', $1, 'Transfection', 'n', 'd', 'partial')`,
          [TYPE_TRANSFECTION],
        ),
      (err: unknown) => (err as { constraint?: string }).constraint === 'protocol_reports_outcome_check',
    );
  });

  test('a recycled report always records who recycled it', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    await assert.rejects(
      () => getPool().query('UPDATE protocol_reports SET deleted_at = now() WHERE id = $1', [report.id]),
      (err: unknown) => (err as { constraint?: string }).constraint === 'protocol_reports_delete_pair',
    );
  });

  test('the SQL normalization matches the TypeScript normalizer exactly', async () => {
    const report = await reportsRepo.createReport({
      ...base,
      researcherEmail: OWNER,
      descriptionText: 'line one   \r\nline two\t\r\n\r\n  ',
    });
    const stored = await reportsRepo.getReport(report.id);
    assert.equal(stored?.descriptionNormalized, 'line one\nline two');
  });

  test('free text is stored verbatim and is never interpreted as SQL', async () => {
    const injection = "'; DROP TABLE protocol_reports; --";
    const report = await reportsRepo.createReport({
      ...base,
      researcherEmail: OWNER,
      protocolName: injection,
      descriptionText: injection,
    });
    const stored = await reportsRepo.getReport(report.id);
    assert.equal(stored?.descriptionText, injection);

    const stillThere = await getPool().query('SELECT count(*) AS c FROM protocol_reports');
    assert.equal(Number(stillThere.rows[0].c), 1);
  });

  test('a text search containing SQL metacharacters is handled as data', async () => {
    await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    const result = await reportsRepo.listReports(
      reportFilterSchema.parse({ q: "'; DROP TABLE protocol_reports; --" }),
    );
    assert.equal(result.total, 0);
    const stillThere = await getPool().query('SELECT count(*) AS c FROM protocol_reports');
    assert.equal(Number(stillThere.rows[0].c), 1);
  });
});
