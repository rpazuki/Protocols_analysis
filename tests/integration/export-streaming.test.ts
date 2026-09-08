import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, reportsRepo } from '@protocols/db';
import type { ExportRequest } from '@protocols/domain';
import {
  OWNER,
  TYPE_TRANSFECTION,
  setupDatabase,
  skipWithoutDatabase,
  teardownDatabase,
} from '../helpers/db.ts';

/**
 * Export streaming holds a transaction and a server-side cursor open for the
 * life of the download. A browser that cancels part-way through stops
 * consuming the generator, so the cleanup path has to run without the loop
 * ever reaching COMMIT - otherwise the connection returns to the pool still
 * inside a transaction, holding a snapshot open.
 */

const CSV_REQUEST: ExportRequest = { format: 'csv', includeRecycled: false };

async function seedReports(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await reportsRepo.createReport({
      // Distinct dates keep each row outside the exact-duplicate key.
      reportDate: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
      protocolTypeId: TYPE_TRANSFECTION,
      protocolTypeLabelSnapshot: 'Transfection',
      protocolName: `Report ${i}`,
      descriptionText: `Variation number ${i}.`,
      outcome: i % 2 === 0 ? 'success' : 'failure',
      outcomeHypothesis: null,
      researcherEmail: OWNER,
    });
  }
}

/** Connections sitting in an unfinished transaction, as the server sees them. */
async function idleInTransactionCount(): Promise<number> {
  const res = await getPool().query<{ n: number }>(
    `SELECT count(*)::bigint AS n
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND state IN ('idle in transaction', 'idle in transaction (aborted)')`,
  );
  return res.rows[0]?.n ?? 0;
}

describe('export streaming cleanup', { skip: skipWithoutDatabase }, () => {
  beforeEach(setupDatabase);
  after(teardownDatabase);

  test('a fully consumed export commits and leaves no open transaction', async () => {
    await seedReports(5);

    const rows = [];
    for await (const batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 2)) {
      rows.push(...batch);
    }
    assert.equal(rows.length, 5);
    assert.equal(await idleInTransactionCount(), 0);
  });

  test('abandoning the stream after one batch does not leave an open transaction', async () => {
    await seedReports(10);

    // This is a cancelled download: the consumer takes one batch and stops.
    for await (const batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 2)) {
      assert.equal(batch.length, 2);
      break;
    }

    assert.equal(
      await idleInTransactionCount(),
      0,
      'the abandoned export left a connection idle in transaction',
    );
  });

  test('a connection reused after an abandoned export works normally', async () => {
    await seedReports(10);

    for await (const _batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 2)) {
      break;
    }

    // The released connection must be usable, not stuck mid-transaction with a
    // stale cursor named export_cursor.
    const rows = [];
    for await (const batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 4)) {
      rows.push(...batch);
    }
    assert.equal(rows.length, 10);
  });

  test('repeated abandoned exports do not exhaust the pool', async () => {
    await seedReports(6);

    // With a leak, each abandoned export would retire one pooled connection.
    for (let i = 0; i < 12; i += 1) {
      for await (const _batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 1)) {
        break;
      }
    }

    assert.equal(await idleInTransactionCount(), 0);
    const stillWorks = await reportsRepo.countReportsForExport(CSV_REQUEST);
    assert.equal(stillWorks, 6);
  });

  test('an empty export completes cleanly', async () => {
    const rows = [];
    for await (const batch of reportsRepo.streamReportsForExport(CSV_REQUEST, 100)) {
      rows.push(...batch);
    }
    assert.equal(rows.length, 0);
    assert.equal(await idleInTransactionCount(), 0);
  });

  test('recycled reports are streamed only when asked for', async () => {
    await seedReports(3);
    const all = await reportsRepo.listReports(
      { state: 'active', page: 1, pageSize: 10 },
      OWNER,
    );
    await reportsRepo.recycleReport(all.reports[0]!.id, OWNER);

    const collect = async (includeRecycled: boolean): Promise<number> => {
      let n = 0;
      for await (const batch of reportsRepo.streamReportsForExport({
        format: 'csv',
        includeRecycled,
      })) {
        n += batch.length;
      }
      return n;
    };

    assert.equal(await collect(false), 2);
    assert.equal(await collect(true), 3);
  });
});
