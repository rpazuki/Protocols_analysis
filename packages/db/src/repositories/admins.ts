import { query, withTransaction, type Queryable } from '../client.ts';
import { mapAdminEntry, type AdminAllowlistRow } from '../mappers.ts';
import { assertRemovable, normalizeEmail, type AdminAllowlistEntry } from '@protocols/domain';

const COLUMNS = 'email, added_at, added_by, removed_at, removed_by, from_config';

/**
 * Reconciles the deployment-config bootstrap list into the database on
 * startup. Config is the source of truth for its own entries: a config admin
 * that was removed in the database is reinstated, so a lab admin can always
 * recover access by editing ADMIN_BOOTSTRAP_EMAILS on the VM and restarting.
 */
export async function syncConfigAdmins(configEmails: string[]): Promise<AdminAllowlistEntry[]> {
  const emails = configEmails.map(normalizeEmail).filter((e) => e.includes('@'));
  if (emails.length === 0) return [];

  return withTransaction(async (client) => {
    const res = await client.query<AdminAllowlistRow>(
      `INSERT INTO admin_allowlist (email, added_by, from_config)
       SELECT unnest($1::text[]), 'config:bootstrap', true
       ON CONFLICT (email) DO UPDATE
         SET from_config = true,
             removed_at  = NULL,
             removed_by  = NULL
       RETURNING ${COLUMNS}`,
      [emails],
    );
    // Config entries that were dropped from config stay in the database as
    // normal admins; removing them silently on restart would be a surprising
    // way to lose access.
    await client.query(
      `UPDATE admin_allowlist SET from_config = false
        WHERE from_config = true AND email <> ALL($1::text[])`,
      [emails],
    );
    return res.rows.map(mapAdminEntry);
  });
}

export async function listAdmins(
  options: { includeRemoved?: boolean } = {},
  client?: Queryable,
): Promise<AdminAllowlistEntry[]> {
  const where = options.includeRemoved ? '' : 'WHERE removed_at IS NULL';
  const res = await query<AdminAllowlistRow>(
    `SELECT ${COLUMNS} FROM admin_allowlist ${where} ORDER BY from_config DESC, email ASC`,
    [],
    client,
  );
  return res.rows.map(mapAdminEntry);
}

export async function listActiveAdminEmails(client?: Queryable): Promise<string[]> {
  const res = await query<{ email: string }>(
    'SELECT email FROM admin_allowlist WHERE removed_at IS NULL ORDER BY email',
    [],
    client,
  );
  return res.rows.map((r) => r.email);
}

export async function isActiveAdmin(email: string, client?: Queryable): Promise<boolean> {
  const res = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM admin_allowlist WHERE email = $1 AND removed_at IS NULL) AS exists',
    [normalizeEmail(email)],
    client,
  );
  return res.rows[0]?.exists ?? false;
}

/** Pass `client` to commit this together with its audit event. */
export async function addAdmin(
  email: string,
  actorEmail: string,
  client?: Queryable,
): Promise<AdminAllowlistEntry> {
  const res = await query<AdminAllowlistRow>(
    `INSERT INTO admin_allowlist (email, added_by, from_config)
     VALUES ($1, $2, false)
     ON CONFLICT (email) DO UPDATE
       SET removed_at = NULL,
           removed_by = NULL,
           added_at   = now(),
           added_by   = EXCLUDED.added_by
     RETURNING ${COLUMNS}`,
    [normalizeEmail(email), normalizeEmail(actorEmail)],
    client,
  );
  return mapAdminEntry(res.rows[0]!);
}

/**
 * Soft-removes an admin.
 *
 * The last-admin and config-admin guards run against a `FOR UPDATE`-locked row
 * set, so two admins removing each other concurrently cannot both succeed and
 * leave the app with no admin. Pass `client` to join a caller's transaction so
 * the removal and its audit event commit together; without one this opens its
 * own transaction.
 */
export async function removeAdmin(
  email: string,
  actorEmail: string,
  client?: Queryable,
): Promise<AdminAllowlistEntry> {
  const run = async (tx: Queryable): Promise<AdminAllowlistEntry> => {
    const current = await tx.query<AdminAllowlistRow>(
      `SELECT ${COLUMNS} FROM admin_allowlist WHERE removed_at IS NULL ORDER BY email FOR UPDATE`,
    );
    assertRemovable({
      target: email,
      actor: actorEmail,
      activeAdmins: current.rows.map((r) => r.email),
      configAdmins: current.rows.filter((r) => r.from_config).map((r) => r.email),
    });

    const res = await tx.query<AdminAllowlistRow>(
      `UPDATE admin_allowlist
          SET removed_at = now(), removed_by = $2
        WHERE email = $1 AND removed_at IS NULL
        RETURNING ${COLUMNS}`,
      [normalizeEmail(email), normalizeEmail(actorEmail)],
    );
    return mapAdminEntry(res.rows[0]!);
  };

  return client ? run(client) : withTransaction(run);
}
