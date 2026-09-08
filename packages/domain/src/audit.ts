/**
 * Audit events cover every sensitive operation named in the plan:
 * create, edit, copy-from-existing, recycle-bin move, restore, permanent
 * delete, admin-list changes, protocol-type changes, agreement acceptance,
 * and exports.
 *
 * Keep the payload minimal: actor email, action, target, timestamp, and small
 * metadata. Never copy report free text into an audit event.
 */
export const AUDIT_ACTIONS = [
  'report.create',
  'report.create_from_existing',
  'report.update',
  'report.recycle',
  'report.restore',
  'report.permanent_delete',
  'protocol_type.create',
  'protocol_type.update',
  'admin.add',
  'admin.remove',
  'access.deny',
  'access.restore',
  'agreement.accept',
  'export.run',
  'auth.login',
  'auth.denied',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = [
  'protocol_report',
  'protocol_type',
  'admin_allowlist',
  'researcher_denylist',
  'user_agreement',
  'export',
  'session',
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditEvent {
  id: string;
  actorEmail: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventInput {
  actorEmail: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Metadata allowlist guard. Audit rows must not accumulate report free text or
 * anything else that widens the personal-data footprint, so metadata values are
 * capped and long strings are truncated.
 */
const METADATA_VALUE_MAX = 300;
const METADATA_KEY_MAX = 20;

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (count >= METADATA_KEY_MAX) break;
    count += 1;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > METADATA_VALUE_MAX ? `${value.slice(0, METADATA_VALUE_MAX)}…` : value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (typeof v === 'string' ? v.slice(0, 100) : v));
    }
    // Objects and functions are dropped on purpose.
  }
  return out;
}
