#!/usr/bin/env node
/**
 * Applies pending migrations from db/migrations.
 *
 * Usage: npm run db:migrate
 * Requires DATABASE_URL. Run as the database owner, not as protocols_app.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, runMigrations } from '@protocols/db';
import { loadDotEnv } from './env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

async function main(): Promise<void> {
  loadDotEnv(repoRoot);
  const result = await runMigrations(path.join(repoRoot, 'db', 'migrations'), {
    logger: (m) => console.log(`  ${m}`),
  });
  console.log(
    result.applied.length
      ? `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`
      : 'Database is up to date.',
  );
  if (result.skipped.length) console.log(`Already applied: ${result.skipped.length} file(s).`);
}

main()
  .catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
