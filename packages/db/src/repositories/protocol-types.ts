import { query, type Queryable } from '../client.ts';
import { mapProtocolType, type ProtocolTypeRow } from '../mappers.ts';
import type { ProtocolType, ProtocolTypeInput, ProtocolTypeUpdate } from '@protocols/domain';

const COLUMNS = 'id, label, description, active, sort_order, created_at, updated_at';

export async function listProtocolTypes(
  options: { includeInactive?: boolean } = {},
  client?: Queryable,
): Promise<ProtocolType[]> {
  const where = options.includeInactive ? '' : 'WHERE active = true';
  const res = await query<ProtocolTypeRow>(
    `SELECT ${COLUMNS} FROM protocol_types ${where} ORDER BY sort_order ASC, lower(label) ASC`,
    [],
    client,
  );
  return res.rows.map(mapProtocolType);
}

export async function getProtocolType(id: string, client?: Queryable): Promise<ProtocolType | null> {
  const res = await query<ProtocolTypeRow>(`SELECT ${COLUMNS} FROM protocol_types WHERE id = $1`, [id], client);
  return res.rows[0] ? mapProtocolType(res.rows[0]) : null;
}

export async function createProtocolType(input: ProtocolTypeInput, client?: Queryable): Promise<ProtocolType> {
  const res = await query<ProtocolTypeRow>(
    `INSERT INTO protocol_types (label, description, active, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.label, input.description, input.active, input.sortOrder],
    client,
  );
  return mapProtocolType(res.rows[0]!);
}

export async function updateProtocolType(
  id: string,
  input: ProtocolTypeUpdate,
  client?: Queryable,
): Promise<ProtocolType | null> {
  const res = await query<ProtocolTypeRow>(
    `UPDATE protocol_types
        SET label       = COALESCE($2, label),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            active      = COALESCE($5, active),
            sort_order  = COALESCE($6, sort_order)
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      input.label ?? null,
      Object.prototype.hasOwnProperty.call(input, 'description'),
      input.description ?? null,
      input.active ?? null,
      input.sortOrder ?? null,
    ],
    client,
  );
  return res.rows[0] ? mapProtocolType(res.rows[0]) : null;
}

/** Counts reports referencing a type, so the UI can warn before disabling it. */
export async function countReportsForType(id: string, client?: Queryable): Promise<number> {
  const res = await query<{ count: number }>(
    'SELECT count(*)::bigint AS count FROM protocol_reports WHERE protocol_type_id = $1',
    [id],
    client,
  );
  return res.rows[0]?.count ?? 0;
}
