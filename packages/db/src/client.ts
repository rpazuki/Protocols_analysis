import pg from 'pg';

const { Pool, types } = pg;

/**
 * PostgreSQL `date` (OID 1082) must not go through JS Date parsing: a report
 * date of 2026-08-30 read as a Date in a non-UTC process can render as the
 * 29th. Return the raw YYYY-MM-DD string instead.
 */
types.setTypeParser(1082, (value: string) => value);

/** int8 (OID 20) counts come back as strings by default; we only ever count rows. */
types.setTypeParser(20, (value: string) => Number(value));

export type Queryable = Pick<pg.PoolClient, 'query'>;

export interface DbConfig {
  connectionString: string;
  /** Enables TLS to PostgreSQL. Required in production unless the DB is on the same host over a unix socket. */
  ssl: boolean;
  /** Rejects self-signed DB certificates. Set false only with a documented internal CA. */
  sslRejectUnauthorized: boolean;
  maxConnections: number;
  statementTimeoutMs: number;
}

export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  return {
    connectionString,
    ssl: env.DATABASE_SSL === 'true',
    sslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    maxConnections: Number(env.DATABASE_POOL_MAX ?? 10),
    statementTimeoutMs: Number(env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15_000),
  };
}

export function createPool(config: DbConfig = dbConfigFromEnv()): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    ssl: config.ssl ? { rejectUnauthorized: config.sslRejectUnauthorized } : undefined,
    statement_timeout: config.statementTimeoutMs,
    application_name: 'protocols-analysis',
  });
}

let pool: pg.Pool | null = null;

/**
 * Process-wide pool. Next.js reloads modules in development, so the pool is
 * cached on globalThis to avoid leaking a connection pool per hot reload.
 */
export function getPool(): pg.Pool {
  const globalRef = globalThis as typeof globalThis & { __protocolsPool?: pg.Pool };
  if (globalRef.__protocolsPool) return globalRef.__protocolsPool;
  if (!pool) pool = createPool();
  globalRef.__protocolsPool = pool;
  return pool;
}

export async function closePool(): Promise<void> {
  const globalRef = globalThis as typeof globalThis & { __protocolsPool?: pg.Pool };
  await globalRef.__protocolsPool?.end();
  delete globalRef.__protocolsPool;
  pool = null;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = getPool(),
): Promise<pg.QueryResult<R>> {
  return client.query<R>(text, params as never[]);
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL unique_violation. */
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== UNIQUE_VIOLATION) return false;
  return constraint ? e.constraint === constraint : true;
}
