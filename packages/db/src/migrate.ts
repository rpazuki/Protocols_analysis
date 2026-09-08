import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getPool, withTransaction } from './client.ts';

/**
 * Minimal forward-only migration runner.
 *
 * Files in db/migrations are applied in filename order, each in its own
 * transaction, and recorded with a checksum. An already-applied file whose
 * contents changed is a hard error: on the production VM that means someone
 * edited history, and silently ignoring it would leave the schema undefined.
 */

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function checksum(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

export async function runMigrations(
  migrationsDir: string,
  options: { logger?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.logger ?? (() => {});
  const pool = getPool();
  await pool.query(MIGRATIONS_TABLE);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied = await pool.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations',
  );
  const appliedMap = new Map(applied.rows.map((r) => [r.filename, r.checksum]));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    const contents = await readFile(path.join(migrationsDir, file), 'utf8');
    const sum = checksum(contents);
    const previous = appliedMap.get(file);

    if (previous) {
      if (previous !== sum) {
        throw new Error(
          `Migration ${file} has already been applied but its contents have changed. ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
      result.skipped.push(file);
      continue;
    }

    log(`applying ${file}`);
    await withTransaction(async (client) => {
      await client.query(contents);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]);
    });
    result.applied.push(file);
  }

  return result;
}

/** Applies seed files. Seeds are re-runnable and are never checksum-tracked. */
export async function runSeeds(
  seedsDir: string,
  options: { logger?: (message: string) => void } = {},
): Promise<string[]> {
  const log = options.logger ?? (() => {});
  const files = (await readdir(seedsDir)).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  const pool = getPool();
  const run: string[] = [];
  for (const file of files) {
    const contents = await readFile(path.join(seedsDir, file), 'utf8');
    log(`seeding ${file}`);
    await pool.query(contents);
    run.push(file);
  }
  return run;
}
