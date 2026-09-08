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
    await query('SELECT 1');
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
