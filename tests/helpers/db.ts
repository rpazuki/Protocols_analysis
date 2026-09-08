import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool, runMigrations } from '@protocols/db';
import { loadDotEnv } from '../../scripts/db/env.ts';

/**
 * Test database helper.
 *
 * Integration and security tests need a real PostgreSQL, because the rules
 * they check (the exact-duplicate unique index, the CHECK constraints, the
 * generated normalization column) live in the database rather than in
 * application code. Set TEST_DATABASE_URL to point at a throwaway database;
 * the suites skip themselves when it is absent so `npm test` still runs on a
 * machine with no PostgreSQL.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

loadDotEnv(repoRoot);

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? null;

/**
 * Skipping is a local convenience, never a CI outcome.
 *
 * The strongest guarantees in this project - the exact-duplicate unique index,
 * the CHECK constraints, cross-researcher isolation - only exist against a real
 * database. A CI run that quietly skipped them would report green while testing
 * none of them, so CI fails loudly instead.
 */
const requireDatabase =
  process.env.REQUIRE_TEST_DATABASE === 'true' || process.env.CI === 'true';

if (requireDatabase && !testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required when CI=true or REQUIRE_TEST_DATABASE=true, but it is not set. ' +
      'Database-backed tests must not be skipped in CI: start a PostgreSQL service and set TEST_DATABASE_URL.',
  );
}

export const skipWithoutDatabase = testDatabaseUrl
  ? false
  : 'TEST_DATABASE_URL is not set; skipping database-backed tests. Set REQUIRE_TEST_DATABASE=true to make this an error.';

if (testDatabaseUrl) {
  // The repositories read DATABASE_URL, so point them at the test database.
  process.env.DATABASE_URL = testDatabaseUrl;
}

let migrated = false;

export async function setupDatabase(): Promise<void> {
  if (!testDatabaseUrl) return;
  if (!migrated) {
    await runMigrations(path.join(repoRoot, 'db', 'migrations'));
    migrated = true;
  }
  await truncateAll();
  // ON CONFLICT keeps this safe to call from several suite hooks in one file.
  await getPool().query(
    `INSERT INTO protocol_types (id, label, active, sort_order) VALUES
       ('11111111-1111-1111-1111-111111111111', 'Transfection', true, 10),
       ('22222222-2222-2222-2222-222222222222', 'Western blot', true, 20),
       ('33333333-3333-3333-3333-333333333333', 'Retired method', false, 30)
     ON CONFLICT DO NOTHING`,
  );
}

export async function truncateAll(): Promise<void> {
  if (!testDatabaseUrl) return;
  await getPool().query(`
    TRUNCATE protocol_reports, report_tombstones, protocol_types,
             admin_allowlist, researcher_denylist, user_agreement_acceptances, audit_events
    RESTART IDENTITY CASCADE
  `);
}

export async function teardownDatabase(): Promise<void> {
  if (!testDatabaseUrl) return;
  await closePool();
}

export const TYPE_TRANSFECTION = '11111111-1111-1111-1111-111111111111';
export const TYPE_WESTERN = '22222222-2222-2222-2222-222222222222';
export const TYPE_RETIRED = '33333333-3333-3333-3333-333333333333';

export const OWNER = 'owner@ic.ac.uk';
export const OTHER = 'other@ic.ac.uk';
export const ADMIN = 'admin@ic.ac.uk';
