#!/usr/bin/env node
/**
 * Applies development seed data from db/seeds.
 *
 * Usage: npm run db:seed
 * Refuses to run when NODE_ENV=production: the seeds create mock users and
 * a mock admin, which must never exist in an environment holding lab data.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, runSeeds } from '@protocols/db';
import { loadDotEnv } from './env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

async function main(): Promise<void> {
  loadDotEnv(repoRoot);

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEEDS_IN_PRODUCTION !== 'yes-i-am-sure') {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Seeds create mock users and a mock admin allowlist entry.',
    );
  }

  const files = await runSeeds(path.join(repoRoot, 'db', 'seeds'), { logger: (m) => console.log(`  ${m}`) });
  console.log(`Seeded ${files.length} file(s).`);
}

main()
  .catch((err: unknown) => {
    console.error('Seeding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
