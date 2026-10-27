import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '@protocols/domain';
import { query, withTransaction, type Queryable } from './client.ts';

const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_PASSWORD_LENGTH = 1024;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Passwords must contain between 12 and 1024 characters.');
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const [, salt, key] = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded) ?? [];
  if (!salt || !key) return false;
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}

// Unknown accounts still perform one password derivation, avoiding a cheap existence probe.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

interface LocalAccount {
  email: string;
  password_hash: string;
  credential_version: number;
  is_active: boolean;
  failed_login_count: number;
  locked_until: Date | null;
}

/** Lockout counters commit even when credentials fail; callers throw after this returns. */
export async function authenticate(email: string, password: string): Promise<{ email: string; version: number } | null> {
  return withTransaction(async (client) => {
    const result = await client.query<LocalAccount>(
      'SELECT * FROM local_accounts WHERE email = $1 FOR UPDATE', [normalizeEmail(email)],
    );
    const account = result.rows[0];
    const valid = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
    if (!account || !account.is_active || (account.locked_until && account.locked_until > new Date())) return null;
    if (!valid) {
      await client.query(
        `UPDATE local_accounts SET
           failed_login_count = CASE WHEN locked_until <= now() THEN 1 ELSE failed_login_count + 1 END,
           locked_until = CASE WHEN
             (CASE WHEN locked_until <= now() THEN 1 ELSE failed_login_count + 1 END) >= 10
             THEN now() + interval '15 minutes' ELSE NULL END
         WHERE email = $1`, [account.email],
      );
      return null;
    }
    await client.query(
      'UPDATE local_accounts SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE email = $1',
      [account.email],
    );
    return { email: account.email, version: account.credential_version };
  });
}

export async function isSessionCurrent(email: string, version: number): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM local_accounts WHERE email = $1 AND is_active AND credential_version = $2',
    [normalizeEmail(email), version],
  );
  return result.rowCount === 1;
}

/** Owner-only administrative provisioning. A reset invalidates all old sessions. */
export async function setPassword(email: string, password: string, create: boolean, client?: Queryable, mustChangePassword = false): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new Error('Supply a valid email address.');
  }
  const hash = await hashPassword(password);
  if (create) {
    await query('INSERT INTO local_accounts (email, password_hash, must_change_password) VALUES ($1, $2, $3)', [normalized, hash, mustChangePassword], client);
  } else {
    const result = await query(
      `UPDATE local_accounts SET password_hash = $2, credential_version = credential_version + 1,
       failed_login_count = 0, locked_until = NULL, must_change_password=$3, updated_at = now() WHERE email = $1`,
      [normalized, hash, mustChangePassword], client,
    );
    if (!result.rowCount) throw new Error('No local account exists for this email.');
  }
}

export async function disable(email: string, client?: Queryable): Promise<void> {
  const result = await query(
    `UPDATE local_accounts SET is_active = false, credential_version = credential_version + 1,
     updated_at = now() WHERE email = $1`, [normalizeEmail(email)], client,
  );
  if (!result.rowCount) throw new Error('No local account exists for this email.');
}

/** Safe session state: never includes credential hashes. Read on every request. */
export async function sessionState(email: string, version: number): Promise<{ mustChangePassword: boolean } | null> {
  const result = await query('SELECT must_change_password FROM local_accounts WHERE email=$1 AND is_active AND credential_version=$2', [normalizeEmail(email), version]);
  return result.rows[0] ? { mustChangePassword: result.rows[0].must_change_password } : null;
}

export async function listAccounts(search = '', page = 1, pageSize = 25) {
  const filter = `%${normalizeEmail(search).slice(0, 320)}%`;
  const count = await query('SELECT count(*) AS total FROM local_accounts WHERE email ILIKE $1', [filter]);
  const rows = await query(`SELECT l.email,l.is_active,l.must_change_password,l.last_login_at,l.created_at,l.locked_until,
    a.email IS NOT NULL AS is_admin,coalesce(a.from_config,false) AS from_config,
    EXISTS(SELECT 1 FROM researcher_denylist d WHERE d.email=l.email AND d.removed_at IS NULL) AS blocked
    FROM local_accounts l LEFT JOIN admin_allowlist a ON a.email=l.email AND a.removed_at IS NULL
    WHERE l.email ILIKE $1 ORDER BY l.email LIMIT $2 OFFSET $3`, [filter,pageSize,(page-1)*pageSize]);
  return { accounts: rows.rows as Array<{ email: string; is_active: boolean; must_change_password: boolean;
    last_login_at: Date | null; created_at: Date; locked_until: Date | null; is_admin: boolean; from_config: boolean; blocked: boolean }>, total: Number(count.rows[0]?.total ?? 0) };
}

export type AccountOperation = 'create' | 'reset' | 'disable' | 'reactivate' | 'promote' | 'demote';

/** The database function checks the current actor, protects admins, and audits atomically. */
export async function manageAccount(actor: string, version: number, email: string, operation: AccountOperation, password?: string, client?: Queryable): Promise<void> {
  const hash = password === undefined ? null : await hashPassword(password);
  await query('SELECT public.protocols_manage_local_account($1,$2,$3,$4,$5)', [normalizeEmail(actor),version,normalizeEmail(email),operation,hash], client);
}

export async function changePassword(email: string, version: number, currentPassword: string, newPassword: string): Promise<number> {
  const account = await authenticate(email, currentPassword);
  if (!account || account.version !== version) throw new Error('The current password is not valid. Sign in again if your password was reset.');
  if (currentPassword === newPassword) throw new Error('Choose a new password different from the current password.');
  const hash = await hashPassword(newPassword);
  const result = await query('SELECT public.protocols_change_local_password($1,$2,$3) AS version', [normalizeEmail(email),version,hash]);
  return result.rows[0]!.version;
}

/** Owner-only recovery, used when no working administrator session remains. */
export async function reactivate(email: string, client?: Queryable): Promise<void> {
  const result = await query(`UPDATE local_accounts SET is_active=true, credential_version=credential_version+1,
    failed_login_count=0, locked_until=NULL, updated_at=now() WHERE email=$1`,[normalizeEmail(email)],client);
  if (!result.rowCount) throw new Error('No local account exists for this email.');
}
