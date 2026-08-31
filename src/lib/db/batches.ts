import { getSql, hasDatabase, newId } from './client';

/**
 * Batches: "everything up to study id N, done by date D".
 *
 * The lead's real unit of planning. Until now it was two anonymous integers in
 * a Redis blob with no date, no name and no history, so nothing could say how
 * far behind anyone was — only how far along.
 */

export interface Batch {
  id: string;
  name: string;
  studyIdCutoff: number;
  dueDate: string | null;
  /** Empty means every visible unit. */
  unitIds: string[];
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface BatchInput {
  name: string;
  studyIdCutoff: number;
  dueDate?: string | null;
  unitIds?: string[];
}

type BatchRow = {
  id: string;
  name: string;
  study_id_cutoff: number;
  due_date: string | Date | null;
  unit_ids: string[];
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
};

/** `due_date` is a DATE: keep it as a plain YYYY-MM-DD, never a timestamp. */
function toDateString(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  return value.slice(0, 10);
}

function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    name: row.name,
    studyIdCutoff: Number(row.study_id_cutoff),
    dueDate: toDateString(row.due_date),
    unitIds: row.unit_ids ?? [],
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
  };
}

const COLUMNS = 'id, name, study_id_cutoff, due_date, unit_ids, created_by, created_at, closed_at';

export async function listBatches(includeClosed = false): Promise<Batch[]> {
  if (!hasDatabase()) return [];
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM batch
      WHERE ($1::boolean OR closed_at IS NULL)
      ORDER BY closed_at IS NOT NULL, due_date NULLS LAST, created_at DESC`,
    [includeClosed],
  );
  return (rows as BatchRow[]).map(toBatch);
}

export async function findBatch(id: string): Promise<Batch | null> {
  if (!hasDatabase()) return null;
  const sql = getSql();
  const rows = await sql.query(`SELECT ${COLUMNS} FROM batch WHERE id = $1`, [id]);
  return rows.length ? toBatch(rows[0] as BatchRow) : null;
}

export async function createBatch(input: BatchInput, createdBy: string | null): Promise<Batch> {
  const sql = getSql();
  const id = newId();
  const rows = await sql.query(
    `INSERT INTO batch (id, name, study_id_cutoff, due_date, unit_ids, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [id, input.name, input.studyIdCutoff, input.dueDate ?? null, input.unitIds ?? [], createdBy],
  );
  return toBatch(rows[0] as BatchRow);
}

export async function updateBatch(id: string, changes: Partial<BatchInput> & { closed?: boolean }): Promise<Batch | null> {
  const sql = getSql();
  const rows = await sql.query(
    `UPDATE batch SET
       name            = COALESCE($2, name),
       study_id_cutoff = COALESCE($3, study_id_cutoff),
       due_date        = CASE WHEN $4::boolean THEN $5::date ELSE due_date END,
       unit_ids        = COALESCE($6::text[], unit_ids),
       closed_at       = CASE WHEN $7::boolean IS NULL THEN closed_at
                              WHEN $7::boolean THEN COALESCE(closed_at, now())
                              ELSE NULL END
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      changes.name ?? null,
      changes.studyIdCutoff ?? null,
      // dueDate must be settable to null, which COALESCE cannot express.
      changes.dueDate !== undefined,
      changes.dueDate ?? null,
      changes.unitIds ?? null,
      changes.closed ?? null,
    ],
  );
  return rows.length ? toBatch(rows[0] as BatchRow) : null;
}
