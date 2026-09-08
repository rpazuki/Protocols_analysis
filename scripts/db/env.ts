import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads .env into process.env for the operational scripts.
 *
 * Deliberately tiny and dependency-free: these scripts run on the VM during
 * recovery, when installing packages may not be an option. Existing
 * environment variables always win, so a shell-provided DATABASE_URL is not
 * overwritten by a stale file.
 */
export function loadDotEnv(repoRoot: string, filename = '.env'): void {
  const file = path.join(repoRoot, filename);
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
