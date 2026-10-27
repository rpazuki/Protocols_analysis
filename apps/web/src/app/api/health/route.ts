import { NextResponse } from 'next/server';
import { query } from '@protocols/db';
import { APP_VERSION, config } from '../../../server/config.ts';

/**
 * Liveness/readiness probe for Docker and the VM's monitoring.
 *
 * Unauthenticated by design, so it returns no lab data and no configuration
 * secrets - only whether the process can reach its database.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Local login needs migration 0006; a reachable but outdated database is
    // not ready to serve sessions or user administration.
    await query(config.adapterId === 'local'
      ? 'SELECT must_change_password FROM local_accounts LIMIT 0'
      : 'SELECT 1');
    return NextResponse.json(
      { status: 'ok', version: APP_VERSION, authAdapter: config.adapterId },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'degraded', version: APP_VERSION, database: 'unreachable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
