import { query, type Queryable } from '../client.ts';
import { mapAuditEvent, type AuditEventRow } from '../mappers.ts';
import { WhereBuilder } from '../sql-builder.ts';
import {
  normalizeEmail,
  sanitizeAuditMetadata,
  type AuditEvent,
  type AuditEventInput,
} from '@protocols/domain';

/**
 * Writes an audit event.
 *
 * Audit failures never block the operation being audited from having already
 * happened - the caller decides. Where the plan requires the audit trail
 * (admin changes, exports, permanent delete) the caller writes the event
 * inside the same transaction so the two succeed or fail together.
 */
export async function recordAuditEvent(input: AuditEventInput, client?: Queryable): Promise<void> {
  await query(
    `INSERT INTO audit_events (actor_email, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      normalizeEmail(input.actorEmail),
      input.action,
      input.targetType,
      input.targetId ?? null,
      JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {})),
    ],
    client,
  );
}

export interface AuditQuery {
  actorEmail?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function listAuditEvents(
  q: AuditQuery,
  client?: Queryable,
): Promise<{ events: AuditEvent[]; total: number }> {
  const where = new WhereBuilder()
    .add('action = ??', q.action)
    .add('target_type = ??', q.targetType)
    .add('target_id = ??', q.targetId)
    .add('created_at >= ??', q.from)
    .add('created_at <= ??', q.to);
  if (q.actorEmail) where.add('actor_email = ??', normalizeEmail(q.actorEmail));

  const limit = where.bind(q.pageSize);
  const offset = where.bind((q.page - 1) * q.pageSize);

  const res = await query<AuditEventRow & { total: number }>(
    `SELECT id, actor_email, action, target_type, target_id, metadata, created_at,
            count(*) OVER () AS total
       FROM audit_events
       ${where.sql}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    where.params,
    client,
  );

  return { events: res.rows.map(mapAuditEvent), total: res.rows[0]?.total ?? 0 };
}
