import { query, withTransaction, isUniqueViolation, getPool, type Queryable } from '../client.ts';
import { mapProtocolReport, type ProtocolReportRow } from '../mappers.ts';
import { WhereBuilder } from '../sql-builder.ts';
import {
  DuplicateReportError,
  NotFoundError,
  normalizeDescription,
  normalizeEmail,
  type ProtocolReport,
  type ProtocolReportInput,
  type ReportFilter,
  type ExportRequest,
} from '@protocols/domain';

const COLUMNS = `
  id, report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
  protocol_name, description_text, description_normalized, outcome, outcome_hypothesis,
  created_at, updated_at, deleted_at, deleted_by, restored_at, restored_by
`;

/** The unique index that enforces the exact duplicate rule. */
const DUPLICATE_INDEX = 'protocol_reports_exact_duplicate_idx';

export interface ListReportsResult {
  reports: ProtocolReport[];
  total: number;
}

/**
 * Builds the shared WHERE clause for the researcher history, the admin
 * all-reports view, and exports.
 *
 * `ownerEmail` is the server-side ownership scope. Callers that must not see
 * other researchers' reports pass it; admin views omit it. It is applied here
 * rather than in the UI so no page can accidentally widen its own scope.
 */
function buildWhere(
  filter: Partial<ReportFilter> & { includeRecycled?: boolean },
  ownerEmail?: string,
): WhereBuilder {
  const where = new WhereBuilder();

  if (ownerEmail) where.add('researcher_email = ??', normalizeEmail(ownerEmail));

  const state = filter.state ?? (filter.includeRecycled ? 'all' : 'active');
  if (state === 'active') where.addRaw('deleted_at IS NULL');
  else if (state === 'recycled') where.addRaw('deleted_at IS NOT NULL');

  where.add('report_date >= ??', filter.from);
  where.add('report_date <= ??', filter.to);
  where.add('protocol_type_id = ??', filter.protocolTypeId);
  where.add('outcome = ??', filter.outcome);
  if (filter.researcherEmail) where.add('researcher_email = ??', normalizeEmail(filter.researcherEmail));

  if (filter.q && filter.q.trim() !== '') {
    // websearch_to_tsquery tolerates arbitrary user input without throwing on
    // stray operators, which plainto_/to_tsquery do not.
    where.addMany(
      `to_tsvector('english', protocol_name || ' ' || description_text || ' ' || coalesce(outcome_hypothesis, ''))
         @@ websearch_to_tsquery('english', ??)`,
      [filter.q.trim()],
    );
  }

  return where;
}

export async function listReports(
  filter: ReportFilter,
  ownerEmail?: string,
  client?: Queryable,
): Promise<ListReportsResult> {
  const where = buildWhere(filter, ownerEmail);
  const limit = where.bind(filter.pageSize);
  const offset = where.bind((filter.page - 1) * filter.pageSize);

  const res = await query<ProtocolReportRow & { total: number }>(
    `SELECT ${COLUMNS}, count(*) OVER () AS total
       FROM protocol_reports
       ${where.sql}
      ORDER BY report_date DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    where.params,
    client,
  );

  return {
    reports: res.rows.map(mapProtocolReport),
    total: res.rows[0]?.total ?? 0,
  };
}

export async function getReport(id: string, client?: Queryable): Promise<ProtocolReport | null> {
  const res = await query<ProtocolReportRow>(
    `SELECT ${COLUMNS} FROM protocol_reports WHERE id = $1`,
    [id],
    client,
  );
  return res.rows[0] ? mapProtocolReport(res.rows[0]) : null;
}

/**
 * Looks up an existing report with the same exact-duplicate key. Used to give
 * the researcher a link to the report that blocked their submission; the unique
 * index is what actually guarantees the rule.
 */
export async function findDuplicate(
  params: { researcherEmail: string; reportDate: string; descriptionText: string; excludeId?: string },
  client?: Queryable,
): Promise<ProtocolReport | null> {
  const where = new WhereBuilder()
    .add('researcher_email = ??', normalizeEmail(params.researcherEmail))
    .add('report_date = ??', params.reportDate)
    .add('description_normalized = ??', normalizeDescription(params.descriptionText));
  if (params.excludeId) where.add('id <> ??', params.excludeId);

  const res = await query<ProtocolReportRow>(
    `SELECT ${COLUMNS} FROM protocol_reports ${where.sql} LIMIT 1`,
    where.params,
    client,
  );
  return res.rows[0] ? mapProtocolReport(res.rows[0]) : null;
}

export interface CreateReportParams extends ProtocolReportInput {
  researcherEmail: string;
  protocolTypeLabelSnapshot: string;
}

export async function createReport(params: CreateReportParams, client?: Queryable): Promise<ProtocolReport> {
  try {
    const res = await query<ProtocolReportRow>(
      `INSERT INTO protocol_reports (
         report_date, researcher_email, protocol_type_id, protocol_type_label_snapshot,
         protocol_name, description_text, outcome, outcome_hypothesis
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        params.reportDate,
        normalizeEmail(params.researcherEmail),
        params.protocolTypeId,
        params.protocolTypeLabelSnapshot,
        params.protocolName,
        params.descriptionText,
        params.outcome,
        params.outcomeHypothesis,
      ],
      client,
    );
    return mapProtocolReport(res.rows[0]!);
  } catch (err) {
    await rethrowAsDuplicate(err, {
      researcherEmail: params.researcherEmail,
      reportDate: params.reportDate,
      descriptionText: params.descriptionText,
    });
    throw err;
  }
}

export interface UpdateReportParams extends ProtocolReportInput {
  protocolTypeLabelSnapshot: string;
}

/**
 * Updates an active report. The label snapshot is refreshed only because the
 * researcher may have changed the protocol type; an unchanged type keeps the
 * label it was saved with.
 */
export async function updateReport(
  id: string,
  params: UpdateReportParams,
  client?: Queryable,
): Promise<ProtocolReport> {
  try {
    const res = await query<ProtocolReportRow>(
      `UPDATE protocol_reports
          SET report_date = $2,
              protocol_type_id = $3,
              protocol_type_label_snapshot = $4,
              protocol_name = $5,
              description_text = $6,
              outcome = $7,
              outcome_hypothesis = $8
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${COLUMNS}`,
      [
        id,
        params.reportDate,
        params.protocolTypeId,
        params.protocolTypeLabelSnapshot,
        params.protocolName,
        params.descriptionText,
        params.outcome,
        params.outcomeHypothesis,
      ],
      client,
    );
    if (!res.rows[0]) throw new NotFoundError('That report no longer exists or is in the recycle bin.');
    return mapProtocolReport(res.rows[0]);
  } catch (err) {
    const existing = await getReport(id, client);
    if (existing) {
      await rethrowAsDuplicate(err, {
        researcherEmail: existing.researcherEmail,
        reportDate: params.reportDate,
        descriptionText: params.descriptionText,
        excludeId: id,
      });
    }
    throw err;
  }
}

export async function recycleReport(
  id: string,
  actorEmail: string,
  client?: Queryable,
): Promise<ProtocolReport> {
  const res = await query<ProtocolReportRow>(
    `UPDATE protocol_reports
        SET deleted_at = now(), deleted_by = $2, restored_at = NULL, restored_by = NULL
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, normalizeEmail(actorEmail)],
    client,
  );
  if (!res.rows[0]) throw new NotFoundError('That report is not an active report.');
  return mapProtocolReport(res.rows[0]);
}

export async function restoreReport(
  id: string,
  actorEmail: string,
  client?: Queryable,
): Promise<ProtocolReport> {
  const res = await query<ProtocolReportRow>(
    `UPDATE protocol_reports
        SET deleted_at = NULL, deleted_by = NULL, restored_at = now(), restored_by = $2
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING ${COLUMNS}`,
    [id, normalizeEmail(actorEmail)],
    client,
  );
  if (!res.rows[0]) throw new NotFoundError('That report is not in the recycle bin.');
  return mapProtocolReport(res.rows[0]);
}

/**
 * Permanent delete. The report row - and therefore all protocol free text -
 * is removed. A minimal tombstone is written in the same transaction so the
 * lab can still account for the record without retaining its content.
 */
export async function permanentlyDeleteReport(
  id: string,
  actorEmail: string,
): Promise<{ reportId: string; researcherEmail: string }> {
  return withTransaction(async (client) => {
    const res = await client.query<ProtocolReportRow>(
      `DELETE FROM protocol_reports
        WHERE id = $1 AND deleted_at IS NOT NULL
        RETURNING ${COLUMNS}`,
      [id],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundError('That report is not in the recycle bin.');

    await client.query(
      `INSERT INTO report_tombstones (
         report_id, researcher_email, report_date, created_at, deleted_at, permanently_deleted_by
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (report_id) DO NOTHING`,
      [row.id, row.researcher_email, row.report_date, row.created_at, row.deleted_at, normalizeEmail(actorEmail)],
    );

    return { reportId: row.id, researcherEmail: row.researcher_email };
  });
}

/**
 * Streams export rows with a server-side cursor so a large export does not
 * load the whole table into the app container's memory.
 *
 * A browser that cancels a download stops consuming this generator part-way
 * through, which runs the `finally` block without the loop ever reaching
 * COMMIT. The `settled` flag makes that case roll back explicitly: releasing a
 * client that still has an open transaction would return it to the pool with
 * an idle-in-transaction snapshot held open.
 */
export async function* streamReportsForExport(
  request: ExportRequest,
  batchSize = 500,
): AsyncGenerator<ProtocolReport[], void, unknown> {
  const where = buildWhere(
    {
      from: request.from,
      to: request.to,
      protocolTypeId: request.protocolTypeId,
      researcherEmail: request.researcherEmail,
      outcome: request.outcome,
      q: request.q,
      state: request.includeRecycled ? 'all' : 'active',
    },
    undefined,
  );

  const client = await getPool().connect();
  let settled = false;
  try {
    await client.query('BEGIN');
    await client.query(
      `DECLARE export_cursor NO SCROLL CURSOR FOR
         SELECT ${COLUMNS} FROM protocol_reports ${where.sql}
         ORDER BY report_date ASC, created_at ASC`,
      where.params as never[],
    );
    for (;;) {
      const res = await client.query<ProtocolReportRow>(`FETCH ${batchSize} FROM export_cursor`);
      if (res.rows.length === 0) break;
      // Execution can suspend here indefinitely, or never resume at all if the
      // consumer stops iterating.
      yield res.rows.map(mapProtocolReport);
    }
    await client.query('CLOSE export_cursor');
    await client.query('COMMIT');
    settled = true;
  } finally {
    if (!settled) {
      // Covers a thrown error, an early `break`/`return` by the consumer, and
      // a cancelled HTTP download.
      await client.query('ROLLBACK').catch(() => {});
    }
    client.release();
  }
}

export async function countReportsForExport(request: ExportRequest, client?: Queryable): Promise<number> {
  const where = buildWhere(
    {
      from: request.from,
      to: request.to,
      protocolTypeId: request.protocolTypeId,
      researcherEmail: request.researcherEmail,
      outcome: request.outcome,
      q: request.q,
      state: request.includeRecycled ? 'all' : 'active',
    },
    undefined,
  );
  const res = await query<{ count: number }>(
    `SELECT count(*)::bigint AS count FROM protocol_reports ${where.sql}`,
    where.params,
    client,
  );
  return res.rows[0]?.count ?? 0;
}

/** Distinct researcher emails, for the admin filter dropdown. */
export async function listResearcherEmails(client?: Queryable): Promise<string[]> {
  const res = await query<{ researcher_email: string }>(
    'SELECT DISTINCT researcher_email FROM protocol_reports ORDER BY researcher_email',
    [],
    client,
  );
  return res.rows.map((r) => r.researcher_email);
}

/**
 * Translates the unique-index violation into a domain error that carries a
 * link to the blocking report. The database is the authority on the duplicate
 * rule, so this path runs even when the application-level pre-check passed.
 */
async function rethrowAsDuplicate(
  err: unknown,
  key: { researcherEmail: string; reportDate: string; descriptionText: string; excludeId?: string },
): Promise<never | void> {
  if (!isUniqueViolation(err, DUPLICATE_INDEX)) return;
  const existing = await findDuplicate(key);
  throw new DuplicateReportError(existing?.id ?? 'unknown', existing?.deletedAt ? 'recycled' : 'active');
}
