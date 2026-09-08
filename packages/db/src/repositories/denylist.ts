import { query, withTransaction, type Queryable } from '../client.ts';
import { normalizeEmail, type DenylistEntry } from '@protocols/domain';
import { toIsoTimestamp } from '@protocols/domain';

const COLUMNS = 'email, reason, added_at, added_by, removed_at, removed_by, from_config';

export interface DenylistRow {
  email: string;
  reason: string | null;
  added_at: Date;
  added_by: string;
  removed_at: Date | null;
  removed_by: string | null;
  from_config: boolean;
}

export function mapDenylistEntry(row: DenylistRow): DenylistEntry {
  return {
    email: row.email,
    reason: row.reason,
    addedAt: toIsoTimestamp(row.added_at)!,
    addedBy: row.added_by,
    removedAt: toIsoTimestamp(row.removed_at),
    removedBy: row.removed_by,
    fromConfig: row.from_config,
  };
}

/**
 * Checked on every authenticated request, so this is the hottest query in the
 * app after the session read. The partial index on active rows keeps it to an
 * index lookup.
 */
export async function isDenied(email: string, client?: Queryable): Promise<boolean> {
  const res = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM researcher_denylist WHERE email = $1 AND removed_at IS NULL) AS exists',
    [normalizeEmail(email)],
    client,
  );
  return res.rows[0]?.exists ?? false;
}

export async function listDenylist(
  options: { includeLifted?: boolean } = {},
  client?: Queryable,
): Promise<DenylistEntry[]> {
  const where = options.includeLifted ? '' : 'WHERE removed_at IS NULL';
  const res = await query<DenylistRow>(
    `SELECT ${COLUMNS} FROM researcher_denylist ${where} ORDER BY removed_at NULLS FIRST, email ASC`,
    [],
    client,
  );
  return res.rows.map(mapDenylistEntry);
}

export async function listActiveDeniedEmails(client?: Queryable): Promise<string[]> {
  const res = await query<{ email: string }>(
    'SELECT email FROM researcher_denylist WHERE removed_at IS NULL ORDER BY email',
    [],
    client,
  );
  return res.rows.map((r) => r.email);
}

/**
 * Blocks an address. Re-blocking a previously lifted entry reuses the row and
 * clears the lift, so the table holds one row per address with its current
 * state rather than a growing history of toggles.
 */
export async function denyAccess(
  email: string,
  reason: string | null,
  actorEmail: string,
  client?: Queryable,
): Promise<DenylistEntry> {
  const res = await query<DenylistRow>(
    `INSERT INTO researcher_denylist (email, reason, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET reason     = EXCLUDED.reason,
           added_at   = now(),
           added_by   = EXCLUDED.added_by,
           removed_at = NULL,
           removed_by = NULL
     RETURNING ${COLUMNS}`,
    [normalizeEmail(email), reason, normalizeEmail(actorEmail)],
    client,
  );
  return mapDenylistEntry(res.rows[0]!);
}

/** Lifts a block. Soft, so the record of the original denial survives. */
export async function restoreAccess(
  email: string,
  actorEmail: string,
  client?: Queryable,
): Promise<DenylistEntry | null> {
  const res = await query<DenylistRow>(
    `UPDATE researcher_denylist
        SET removed_at = now(), removed_by = $2
      WHERE email = $1 AND removed_at IS NULL
      RETURNING ${COLUMNS}`,
    [normalizeEmail(email), normalizeEmail(actorEmail)],
    client,
  );
  return res.rows[0] ? mapDenylistEntry(res.rows[0]) : null;
}

/**
 * Reconciles ACCESS_DENYLIST_EMAILS from deployment config, so an urgent block
 * can be applied on the VM without a working admin session.
 *
 * While an address is listed in config it is pinned: re-asserted on every
 * start, and not liftable from the admin page, because config would reinstate
 * it anyway.
 *
 * An address *removed* from config is demoted to an ordinary in-app entry
 * rather than being unblocked. Auto-lifting would mean that tidying a config
 * file silently restores someone's access with nobody deciding to; demoting
 * keeps the block in force and hands control to the admins, who can now see a
 * working restore button. This mirrors how syncConfigAdmins() treats an admin
 * dropped from config: a config edit never silently changes who has access.
 *
 * Runs on every start, including with an empty list, so the demotion happens
 * even when the last entry is removed from config.
 */
export async function syncConfigDenylist(configEmails: string[]): Promise<DenylistEntry[]> {
  const emails = configEmails.map(normalizeEmail).filter((e) => e.includes('@'));

  return withTransaction(async (client) => {
    // Demote anything previously pinned that config no longer lists. The block
    // stays; only its source changes.
    await client.query(
      `UPDATE researcher_denylist
          SET from_config = false
        WHERE from_config = true
          AND email <> ALL($1::text[])`,
      [emails],
    );

    if (emails.length === 0) return [];

    const res = await client.query<DenylistRow>(
      `INSERT INTO researcher_denylist (email, reason, added_by, from_config)
       SELECT unnest($1::text[]), 'Blocked in deployment configuration', 'config:bootstrap', true
       ON CONFLICT (email) DO UPDATE
         SET from_config = true,
             removed_at  = NULL,
             removed_by  = NULL
       RETURNING ${COLUMNS}`,
      [emails],
    );
    return res.rows.map(mapDenylistEntry);
  });
}
