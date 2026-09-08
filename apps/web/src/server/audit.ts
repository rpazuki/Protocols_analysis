import 'server-only';
import { auditRepo, type Queryable } from '@protocols/db';
import { DomainError, type AuditEventInput } from '@protocols/domain';

/**
 * Audit writing has two paths, and the choice between them is a policy
 * decision rather than a convenience.
 *
 * `auditRequired()` is for the events the plan lists as accountability
 * requirements: admin-list changes, protocol-type changes, exports, agreement
 * acceptance, recycle-bin moves, restores, and permanent deletes. If the event
 * cannot be written, the operation must not be reported as successful. Callers
 * that mutate data pass the transaction client so the change and its audit
 * event commit or roll back together.
 *
 * `auditBestEffort()` is for telemetry-style events where losing a row is
 * better than failing the user's request: logins, denied access attempts.
 */

/**
 * Writes an audit event, failing the operation if it cannot be recorded.
 *
 * Pass `client` whenever there is a surrounding transaction, so an operation
 * can never commit without its audit event.
 */
export async function auditRequired(input: AuditEventInput, client?: Queryable): Promise<void> {
  try {
    await auditRepo.recordAuditEvent(input, client);
  } catch (err) {
    console.error('[audit] REQUIRED audit event failed', {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Inside a transaction this propagates and rolls the mutation back. Outside
    // one, it stops the caller from reporting success for an unaudited action.
    throw new DomainError(
      'audit_write_failed',
      'This action could not be recorded in the audit log, so it was not completed. Tell the lab admin.',
      { action: input.action },
    );
  }
}

/**
 * Writes an audit event, logging and swallowing a failure.
 *
 * Only for events where the write is not itself an accountability
 * requirement. Never use this for an admin change, an export, or a deletion.
 */
export async function auditBestEffort(input: AuditEventInput, client?: Queryable): Promise<void> {
  try {
    await auditRepo.recordAuditEvent(input, client);
  } catch (err) {
    console.error('[audit] best-effort event dropped', {
      action: input.action,
      targetType: input.targetType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
