import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportsRepo, getPool } from '@protocols/db';
import { DuplicateReportError, reportFilterSchema } from '@protocols/domain';
import {
  ADMIN,
  OTHER,
  OWNER,
  TYPE_TRANSFECTION,
  TYPE_WESTERN,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
} from '../helpers/db.ts';

describe('protocol report repository', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  const base = {
    reportDate: '2026-08-30',
    protocolTypeId: TYPE_TRANSFECTION,
    protocolTypeLabelSnapshot: 'Transfection',
    protocolName: 'Ratio 1:2',
    descriptionText: 'Swapped reagent A for reagent B.',
    outcome: 'success' as const,
    outcomeHypothesis: null,
  };

  test('creates a report and snapshots the type label', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    assert.equal(report.researcherEmail, OWNER);
    assert.equal(report.protocolTypeLabelSnapshot, 'Transfection');
    assert.equal(report.deletedAt, null);
    assert.equal(report.reportDate, '2026-08-30');
  });

  test('normalizes the researcher email on write', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: 'Owner@IC.AC.UK' });
    assert.equal(report.researcherEmail, 'owner@ic.ac.uk');
  });

  test('renaming a protocol type does not rewrite existing reports', async () => {
    const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
    await getPool().query('UPDATE protocol_types SET label = $2 WHERE id = $1', [
      TYPE_TRANSFECTION,
      'Transfection (v2)',
    ]);
    const reloaded = await reportsRepo.getReport(report.id);
    assert.equal(reloaded?.protocolTypeLabelSnapshot, 'Transfection');
  });

  describe('exact duplicate rule', () => {
    test('blocks an identical resubmission', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await assert.rejects(
        () => reportsRepo.createReport({ ...base, researcherEmail: OWNER }),
        DuplicateReportError,
      );
    });

    test('ignores protocol name, type, outcome, and hypothesis', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await assert.rejects(
        () =>
          reportsRepo.createReport({
            ...base,
            researcherEmail: OWNER,
            protocolName: 'Completely different name',
            protocolTypeId: TYPE_WESTERN,
            protocolTypeLabelSnapshot: 'Western blot',
            outcome: 'failure',
            outcomeHypothesis: 'A different hypothesis.',
          }),
        DuplicateReportError,
      );
    });

    test('blocks whitespace-only variations', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await assert.rejects(
        () =>
          reportsRepo.createReport({
            ...base,
            researcherEmail: OWNER,
            descriptionText: '  Swapped reagent A for reagent B.  \r\n\r\n',
          }),
        DuplicateReportError,
      );
    });

    test('allows a different report date', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const second = await reportsRepo.createReport({
        ...base,
        researcherEmail: OWNER,
        reportDate: '2026-08-31',
      });
      assert.ok(second.id);
    });

    test('allows different wording on the same date', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const second = await reportsRepo.createReport({
        ...base,
        researcherEmail: OWNER,
        descriptionText: 'Swapped reagent A for reagent C.',
      });
      assert.ok(second.id);
    });

    test('allows two researchers to write the same text on the same date', async () => {
      await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const second = await reportsRepo.createReport({ ...base, researcherEmail: OTHER });
      assert.equal(second.researcherEmail, OTHER);
    });

    test('a recycled report still blocks an identical new one', async () => {
      const first = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await reportsRepo.recycleReport(first.id, OWNER);
      await assert.rejects(
        () => reportsRepo.createReport({ ...base, researcherEmail: OWNER }),
        (err: unknown) =>
          err instanceof DuplicateReportError && err.details.existingState === 'recycled',
      );
    });

    test('a permanently deleted report no longer blocks', async () => {
      const first = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await reportsRepo.recycleReport(first.id, OWNER);
      await reportsRepo.permanentlyDeleteReport(first.id, OWNER);
      const again = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      assert.ok(again.id);
    });

    test('editing into an existing duplicate is refused', async () => {
      const first = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const second = await reportsRepo.createReport({
        ...base,
        researcherEmail: OWNER,
        descriptionText: 'Different wording entirely.',
      });
      await assert.rejects(
        () =>
          reportsRepo.updateReport(second.id, {
            ...base,
            descriptionText: base.descriptionText,
          }),
        DuplicateReportError,
      );
      assert.ok(first.id);
    });

    test('editing a report without changing its key succeeds', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const updated = await reportsRepo.updateReport(report.id, {
        ...base,
        protocolName: 'Renamed',
        outcome: 'failure',
      });
      assert.equal(updated.protocolName, 'Renamed');
      assert.equal(updated.outcome, 'failure');
    });
  });

  describe('recycle bin lifecycle', () => {
    test('recycle records who deleted it and hides it from active listings', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      const recycled = await reportsRepo.recycleReport(report.id, OWNER);
      assert.ok(recycled.deletedAt);
      assert.equal(recycled.deletedBy, OWNER);

      const active = await reportsRepo.listReports(reportFilterSchema.parse({}), OWNER);
      assert.equal(active.total, 0);

      const bin = await reportsRepo.listReports(reportFilterSchema.parse({ state: 'recycled' }), OWNER);
      assert.equal(bin.total, 1);
    });

    test('restore clears the deletion and records the restorer', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await reportsRepo.recycleReport(report.id, OWNER);
      const restored = await reportsRepo.restoreReport(report.id, ADMIN);
      assert.equal(restored.deletedAt, null);
      assert.equal(restored.deletedBy, null);
      assert.equal(restored.restoredBy, ADMIN);
      assert.ok(restored.restoredAt);
    });

    test('an active report cannot be restored, and a recycled one cannot be recycled twice', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await assert.rejects(() => reportsRepo.restoreReport(report.id, OWNER));
      await reportsRepo.recycleReport(report.id, OWNER);
      await assert.rejects(() => reportsRepo.recycleReport(report.id, OWNER));
    });

    test('permanent delete removes the content and leaves only a tombstone', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await reportsRepo.recycleReport(report.id, OWNER);
      await reportsRepo.permanentlyDeleteReport(report.id, ADMIN);

      assert.equal(await reportsRepo.getReport(report.id), null);

      const tombstone = await getPool().query(
        'SELECT * FROM report_tombstones WHERE report_id = $1',
        [report.id],
      );
      assert.equal(tombstone.rowCount, 1);
      assert.equal(tombstone.rows[0].researcher_email, OWNER);
      assert.equal(tombstone.rows[0].permanently_deleted_by, ADMIN);
      // The tombstone must not carry the protocol text.
      assert.ok(!('description_text' in tombstone.rows[0]));
    });

    test('an active report cannot be permanently deleted without being recycled first', async () => {
      const report = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await assert.rejects(() => reportsRepo.permanentlyDeleteReport(report.id, ADMIN));
    });
  });

  describe('listing and filtering', () => {
    beforeEach(async () => {
      await reportsRepo.createReport({
        ...base,
        researcherEmail: OWNER,
        reportDate: '2026-08-01',
        descriptionText: 'Lipofectamine at a 1:2 ratio.',
        outcome: 'failure',
      });
      await reportsRepo.createReport({
        ...base,
        researcherEmail: OWNER,
        reportDate: '2026-08-15',
        protocolTypeId: TYPE_WESTERN,
        protocolTypeLabelSnapshot: 'Western blot',
        descriptionText: 'Blocked in BSA rather than milk.',
        outcome: 'success',
      });
      await reportsRepo.createReport({
        ...base,
        researcherEmail: OTHER,
        reportDate: '2026-08-20',
        descriptionText: 'Reduced serum to 5 percent.',
        outcome: 'failure',
      });
    });

    test('the owner scope hides other researchers entirely', async () => {
      const mine = await reportsRepo.listReports(reportFilterSchema.parse({}), OWNER);
      assert.equal(mine.total, 2);
      assert.ok(mine.reports.every((r) => r.researcherEmail === OWNER));
    });

    test('an unscoped listing returns every researcher, for admin views', async () => {
      const all = await reportsRepo.listReports(reportFilterSchema.parse({}));
      assert.equal(all.total, 3);
    });

    test('filters by date range, type, and outcome', async () => {
      const byDate = await reportsRepo.listReports(
        reportFilterSchema.parse({ from: '2026-08-10', to: '2026-08-16' }),
      );
      assert.equal(byDate.total, 1);

      const byType = await reportsRepo.listReports(
        reportFilterSchema.parse({ protocolTypeId: TYPE_WESTERN }),
      );
      assert.equal(byType.total, 1);

      const byOutcome = await reportsRepo.listReports(reportFilterSchema.parse({ outcome: 'failure' }));
      assert.equal(byOutcome.total, 2);
    });

    test('full-text search covers description text', async () => {
      const hits = await reportsRepo.listReports(reportFilterSchema.parse({ q: 'lipofectamine' }));
      assert.equal(hits.total, 1);
    });

    test('search input with punctuation does not throw', async () => {
      const hits = await reportsRepo.listReports(reportFilterSchema.parse({ q: 'ratio & !! "unclosed' }));
      assert.ok(hits.total >= 0);
    });

    test('pagination reports the unpaged total', async () => {
      const page1 = await reportsRepo.listReports(reportFilterSchema.parse({ pageSize: 1, page: 1 }));
      assert.equal(page1.reports.length, 1);
      assert.equal(page1.total, 3);

      const page2 = await reportsRepo.listReports(reportFilterSchema.parse({ pageSize: 1, page: 2 }));
      assert.notEqual(page2.reports[0]!.id, page1.reports[0]!.id);
    });
  });

  describe('export streaming', () => {
    test('streams matching rows and honours includeRecycled', async () => {
      const first = await reportsRepo.createReport({ ...base, researcherEmail: OWNER });
      await reportsRepo.createReport({
        ...base,
        researcherEmail: OTHER,
        descriptionText: 'Another variation.',
      });
      await reportsRepo.recycleReport(first.id, OWNER);

      const collect = async (includeRecycled: boolean) => {
        const out = [];
        for await (const batch of reportsRepo.streamReportsForExport({
          format: 'csv',
          includeRecycled,
        })) {
          out.push(...batch);
        }
        return out;
      };

      assert.equal((await collect(false)).length, 1);
      assert.equal((await collect(true)).length, 2);
    });
  });
});
