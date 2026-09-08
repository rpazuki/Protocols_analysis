import { z } from 'zod';
import { OUTCOMES } from './outcome.ts';
import { isIsoDate } from './dates.ts';
import type { ProtocolReport } from './protocol-report.ts';

/**
 * Bump when the export field set or semantics change. Every exported record
 * carries the version so downstream analysis can branch on it.
 */
export const EXPORT_SCHEMA_VERSION = '1.0.0';

export const EXPORT_FORMATS = ['csv', 'jsonl'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Field order is stable and is also the CSV column order. */
export const EXPORT_FIELDS = [
  'schema_version',
  'report_id',
  'report_date',
  'researcher_email',
  'protocol_type_id',
  'protocol_type_label_snapshot',
  'protocol_name',
  'description_text',
  'outcome',
  'outcome_hypothesis',
  'created_at',
  'updated_at',
  'deleted_at',
  'restored_at',
  'record_state',
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export type ExportRecord = Record<ExportField, string | null>;

export function toExportRecord(report: ProtocolReport): ExportRecord {
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    report_id: report.id,
    report_date: report.reportDate,
    researcher_email: report.researcherEmail,
    protocol_type_id: report.protocolTypeId,
    protocol_type_label_snapshot: report.protocolTypeLabelSnapshot,
    protocol_name: report.protocolName,
    description_text: report.descriptionText,
    outcome: report.outcome,
    outcome_hypothesis: report.outcomeHypothesis,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
    deleted_at: report.deletedAt,
    restored_at: report.restoredAt,
    record_state: report.deletedAt === null ? 'active' : 'recycled',
  };
}

/**
 * RFC 4180 CSV escaping.
 *
 * The leading apostrophe on values starting with = + - @ is a CSV-injection
 * guard: the export plan says these files are opened in spreadsheets, and
 * protocol free text is user-controlled.
 */
export function csvEscape(value: string | null): string {
  if (value === null) return '';
  let out = value;
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[",\r\n]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export function csvHeaderRow(): string {
  return EXPORT_FIELDS.join(',');
}

export function csvRow(record: ExportRecord): string {
  return EXPORT_FIELDS.map((field) => csvEscape(record[field])).join(',');
}

export function toCsv(records: ExportRecord[]): string {
  return [csvHeaderRow(), ...records.map(csvRow)].join('\r\n') + '\r\n';
}

export function jsonlRow(record: ExportRecord): string {
  return JSON.stringify(record);
}

export function toJsonl(records: ExportRecord[]): string {
  return records.map(jsonlRow).join('\n') + (records.length ? '\n' : '');
}

/**
 * Export filters. `includeRecycled` defaults to false: open decision 2 in the
 * plan is resolved as "excluded by default, included only when an admin ticks
 * the box", which is the conservative reading of the export plan.
 */
export const exportRequestSchema = z.object({
  format: z.enum(EXPORT_FORMATS).default('csv'),
  from: z.string().refine(isIsoDate).optional(),
  to: z.string().refine(isIsoDate).optional(),
  researcherEmail: z.string().email().optional(),
  protocolTypeId: z.string().uuid().optional(),
  outcome: z.enum(OUTCOMES).optional(),
  q: z.string().max(500).optional(),
  includeRecycled: z.coerce.boolean().default(false),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;

export function exportFilename(request: ExportRequest, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const scope = request.includeRecycled ? 'all' : 'active';
  return `protocol-reports_${scope}_${stamp}.${request.format}`;
}

export function exportContentType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';
}
