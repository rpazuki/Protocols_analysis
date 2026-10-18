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
export async function setPassword(email: string, password: string, create: boolean, client?: Queryable): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new Error('Supply a valid email address.');
  }
  const hash = await hashPassword(password);
  if (create) {
    await query('INSERT INTO local_accounts (email, password_hash) VALUES ($1, $2)', [normalized, hash], client);
  } else {
    const result = await query(
      `UPDATE local_accounts SET password_hash = $2, credential_version = credential_version + 1,
       failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE email = $1`,
      [normalized, hash], client,
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
