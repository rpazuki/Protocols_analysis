import {
  toIsoDate,
  toIsoTimestamp,
  type AdminAllowlistEntry,
  type AgreementAcceptance,
  type AuditEvent,
  type AuditAction,
  type AuditTargetType,
  type Outcome,
  type ProtocolReport,
  type ProtocolType,
} from '@protocols/domain';

/** Row shapes as returned by PostgreSQL. Kept explicit so column renames break the build. */

export interface ProtocolTypeRow {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export function mapProtocolType(row: ProtocolTypeRow): ProtocolType {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: toIsoTimestamp(row.created_at)!,
    updatedAt: toIsoTimestamp(row.updated_at)!,
  };
}

export interface ProtocolReportRow {
  id: string;
  report_date: string;
  researcher_email: string;
  protocol_type_id: string | null;
  protocol_type_label_snapshot: string;
  protocol_name: string;
  description_text: string;
  description_normalized: string;
  outcome: string;
  outcome_hypothesis: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  restored_at: Date | null;
  restored_by: string | null;
}

export function mapProtocolReport(row: ProtocolReportRow): ProtocolReport {
  return {
    id: row.id,
    reportDate: toIsoDate(row.report_date),
    researcherEmail: row.researcher_email,
    protocolTypeId: row.protocol_type_id,
    protocolTypeLabelSnapshot: row.protocol_type_label_snapshot,
    protocolName: row.protocol_name,
    descriptionText: row.description_text,
    descriptionNormalized: row.description_normalized,
    outcome: row.outcome as Outcome,
    outcomeHypothesis: row.outcome_hypothesis,
    createdAt: toIsoTimestamp(row.created_at)!,
    updatedAt: toIsoTimestamp(row.updated_at)!,
    deletedAt: toIsoTimestamp(row.deleted_at),
    deletedBy: row.deleted_by,
    restoredAt: toIsoTimestamp(row.restored_at),
    restoredBy: row.restored_by,
  };
}

export interface AdminAllowlistRow {
  email: string;
  added_at: Date;
  added_by: string;
  removed_at: Date | null;
  removed_by: string | null;
  from_config: boolean;
}

export function mapAdminEntry(row: AdminAllowlistRow): AdminAllowlistEntry {
  return {
    email: row.email,
    addedAt: toIsoTimestamp(row.added_at)!,
    addedBy: row.added_by,
    removedAt: toIsoTimestamp(row.removed_at),
    removedBy: row.removed_by,
    fromConfig: row.from_config,
  };
}

export interface AgreementRow {
  researcher_email: string;
  agreement_version: string;
  accepted_at: Date;
  accepted_from: string | null;
}

export function mapAgreement(row: AgreementRow): AgreementAcceptance {
  return {
    researcherEmail: row.researcher_email,
    agreementVersion: row.agreement_version,
    acceptedAt: toIsoTimestamp(row.accepted_at)!,
    acceptedFrom: row.accepted_from,
  };
}

export interface AuditEventRow {
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action as AuditAction,
    targetType: row.target_type as AuditTargetType,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    createdAt: toIsoTimestamp(row.created_at)!,
  };
}
