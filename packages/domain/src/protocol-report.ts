import { z } from 'zod';
import { isIsoDate, type IsoDate } from './dates.ts';
import { normalizeDescription, normalizeFreeText, normalizeLabel } from './normalize.ts';
import { OUTCOMES, type Outcome } from './outcome.ts';

/**
 * A protocol report. `protocolTypeLabelSnapshot` is copied onto the row at save
 * time so historic reports keep the label that was active when they were saved,
 * even after an admin renames or disables the protocol type.
 */
export interface ProtocolReport {
  id: string;
  reportDate: IsoDate;
  researcherEmail: string;
  protocolTypeId: string | null;
  protocolTypeLabelSnapshot: string;
  protocolName: string;
  descriptionText: string;
  /** Generated column used by the exact-duplicate unique index. */
  descriptionNormalized: string;
  outcome: Outcome;
  outcomeHypothesis: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  restoredAt: string | null;
  restoredBy: string | null;
}

export const PROTOCOL_NAME_MAX = 200;
/**
 * Descriptions and hypotheses are "long, unrestricted" per the product
 * overview. The caps below exist only as an abuse/payload guard, not as an
 * editorial limit, and are far above realistic protocol notes.
 */
export const DESCRIPTION_MAX = 100_000;
export const HYPOTHESIS_MAX = 100_000;

const isoDateSchema = z
  .string()
  .refine(isIsoDate, 'Report date must be a real calendar date in YYYY-MM-DD form.');

/**
 * Fields a researcher may submit. `researcherEmail` is deliberately absent:
 * identity is derived from the authenticated session server-side and is never
 * accepted from the form (product-overview.md, "System").
 */
export const protocolReportInputSchema = z.object({
  reportDate: isoDateSchema,
  protocolTypeId: z.string().uuid('Select a protocol type.'),
  protocolName: z
    .string()
    .transform(normalizeLabel)
    .pipe(
      z
        .string()
        .min(1, 'Protocol name is required.')
        .max(PROTOCOL_NAME_MAX, `Protocol name must be ${PROTOCOL_NAME_MAX} characters or fewer.`),
    ),
  descriptionText: z
    .string()
    .max(DESCRIPTION_MAX, 'Protocol description is too long.')
    .transform(normalizeFreeText)
    .pipe(z.string().min(1, 'Protocol description is required.')),
  outcome: z.enum(OUTCOMES, { errorMap: () => ({ message: 'Select success or failure.' }) }),
  outcomeHypothesis: z
    .string()
    .max(HYPOTHESIS_MAX, 'Outcome hypothesis is too long.')
    .transform(normalizeFreeText)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null),
});

export type ProtocolReportInput = z.infer<typeof protocolReportInputSchema>;

export const protocolReportUpdateSchema = protocolReportInputSchema;
export type ProtocolReportUpdate = ProtocolReportInput;

/**
 * The exact-duplicate key: same researcher, same report date, same normalized
 * main description. Protocol name, type, outcome, and hypothesis are NOT part
 * of the comparison (product-overview.md, "Exact Duplicate Rule").
 */
export interface DuplicateKey {
  researcherEmail: string;
  reportDate: IsoDate;
  descriptionNormalized: string;
}

export function duplicateKey(input: {
  researcherEmail: string;
  reportDate: IsoDate;
  descriptionText: string;
}): DuplicateKey {
  return {
    researcherEmail: input.researcherEmail.trim().toLowerCase(),
    reportDate: input.reportDate,
    descriptionNormalized: normalizeDescription(input.descriptionText),
  };
}

export function isSameDuplicateKey(a: DuplicateKey, b: DuplicateKey): boolean {
  return (
    a.researcherEmail === b.researcherEmail &&
    a.reportDate === b.reportDate &&
    a.descriptionNormalized === b.descriptionNormalized
  );
}

/**
 * Fields carried over when a researcher chooses "create from this report".
 * The date is intentionally not carried: the new draft defaults to today.
 */
export function draftFromReport(report: ProtocolReport): Omit<ProtocolReportInput, 'reportDate'> {
  return {
    protocolTypeId: report.protocolTypeId ?? '',
    protocolName: report.protocolName,
    descriptionText: report.descriptionText,
    outcome: report.outcome,
    outcomeHypothesis: report.outcomeHypothesis,
  } as Omit<ProtocolReportInput, 'reportDate'>;
}

/**
 * An HTML GET form submits every field, so an untouched filter arrives as an
 * empty string rather than being absent. Treat blank as "no filter" instead of
 * as an invalid date, UUID, or enum value.
 */
export function blankToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  }, schema);
}

/** Filters for the researcher history and the admin all-reports view. */
export const reportFilterSchema = z.object({
  from: blankToUndefined(isoDateSchema.optional()),
  to: blankToUndefined(isoDateSchema.optional()),
  protocolTypeId: blankToUndefined(z.string().uuid('Select a protocol type from the list.').optional()),
  researcherEmail: blankToUndefined(z.string().email().optional()),
  outcome: blankToUndefined(z.enum(OUTCOMES).optional()),
  q: blankToUndefined(z.string().max(500).optional()),
  state: blankToUndefined(z.enum(['active', 'recycled', 'all']).default('active')),
  page: blankToUndefined(z.coerce.number().int().min(1).default(1)),
  pageSize: blankToUndefined(z.coerce.number().int().min(1).max(200).default(25)),
});

export type ReportFilter = z.infer<typeof reportFilterSchema>;

/**
 * Parses filters straight from a page's `searchParams` or a URLSearchParams.
 *
 * Every list page and the mock API go through this, so blank-field handling
 * and the state override cannot drift between them. A caller that must pin the
 * state (the recycle bin, for example) passes `forceState`, which the user
 * cannot override through the query string.
 */
export function parseReportFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
  options: { forceState?: 'active' | 'recycled' | 'all' } = {},
): ReportFilter {
  const raw: Record<string, string | undefined> =
    params instanceof URLSearchParams
      ? Object.fromEntries(params.entries())
      : Object.fromEntries(
          Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
        );

  return reportFilterSchema.parse({
    ...raw,
    ...(options.forceState ? { state: options.forceState } : {}),
  });
}
