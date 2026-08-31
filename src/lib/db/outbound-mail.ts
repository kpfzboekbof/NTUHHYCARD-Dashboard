import { getSql, hasDatabase } from './client';

/**
 * The delivery ledger (§7.4): every mail this system sends to a human, and
 * whether it actually left. The row is written before the send and completed
 * after, so a crash mid-send leaves "attempted, unconfirmed" — never silence.
 */

export interface OutboundMailInput {
  toPersonId: string | null;
  toEmail: string;
  kind: string;
  payload: unknown;
  requestedBy: string | null;
}

export interface OutboundMailRow {
  id: string;
  toPersonId: string | null;
  toPersonName: string | null;
  toEmail: string;
  kind: string;
  payload: unknown;
  requestedBy: string | null;
  requestedByName: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

/** Insert the attempt; returns the row id to complete later. */
export async function recordMailAttempt(input: OutboundMailInput): Promise<string | null> {
  if (!hasDatabase()) return null;
  const sql = getSql();
  const rows = await sql.query(
    `INSERT INTO outbound_mail (to_person_id, to_email, kind, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.toPersonId, input.toEmail, input.kind, JSON.stringify(input.payload), input.requestedBy],
  );
  return String((rows[0] as { id: unknown }).id);
}

export async function markMailSent(id: string | null): Promise<void> {
  if (!hasDatabase() || id === null) return;
  const sql = getSql();
  await sql.query('UPDATE outbound_mail SET sent_at = now() WHERE id = $1', [id]);
}

export async function markMailFailed(id: string | null, error: string): Promise<void> {
  if (!hasDatabase() || id === null) return;
  const sql = getSql();
  await sql.query('UPDATE outbound_mail SET error = $2 WHERE id = $1', [id, error.slice(0, 1000)]);
}

export interface MailFilter {
  personId?: string;
  kind?: string;
  limit?: number;
}

export async function listOutboundMail(filter: MailFilter = {}): Promise<OutboundMailRow[]> {
  if (!hasDatabase()) return [];
  const sql = getSql();
  const rows = await sql.query(
    `SELECT m.id, m.to_person_id, m.to_email, m.kind, m.payload, m.requested_by,
            m.sent_at, m.error, m.created_at,
            p.display_name AS to_name, r.display_name AS requested_by_name
       FROM outbound_mail m
       LEFT JOIN person p ON p.id = m.to_person_id
       LEFT JOIN person r ON r.id = m.requested_by
      WHERE ($1::uuid IS NULL OR m.to_person_id = $1)
        AND ($2::text IS NULL OR m.kind = $2)
      ORDER BY m.created_at DESC
      LIMIT $3`,
    [filter.personId ?? null, filter.kind ?? null, Math.min(filter.limit ?? 100, 500)],
  );

  return (rows as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    toPersonId: (row.to_person_id as string) ?? null,
    toPersonName: (row.to_name as string) ?? null,
    toEmail: row.to_email as string,
    kind: row.kind as string,
    payload: row.payload,
    requestedBy: (row.requested_by as string) ?? null,
    requestedByName: (row.requested_by_name as string) ?? null,
    sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
    error: (row.error as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
}

/**
 * When each person last had a nudge actually sent — the "上次催他" column,
 * without which the same person gets chased twice in a week or forgotten for
 * a month.
 */
export async function lastNudgeByPerson(): Promise<Map<string, string>> {
  if (!hasDatabase()) return new Map();
  const sql = getSql();
  const rows = await sql.query(
    `SELECT to_person_id, max(sent_at) AS last_sent
       FROM outbound_mail
      WHERE kind = 'nudge' AND sent_at IS NOT NULL AND to_person_id IS NOT NULL
      GROUP BY to_person_id`,
    [],
  );
  return new Map(
    (rows as Record<string, unknown>[]).map(row => [
      String(row.to_person_id),
      new Date(row.last_sent as string).toISOString(),
    ]),
  );
}

/** Whether a mail of this kind already went out today (Asia/Taipei) — the watchdog's dedupe. */
export async function alreadySentToday(kind: string): Promise<boolean> {
  if (!hasDatabase()) return false;
  const sql = getSql();
  const rows = await sql.query(
    `SELECT 1 FROM outbound_mail
      WHERE kind = $1
        AND sent_at IS NOT NULL
        AND (sent_at AT TIME ZONE 'Asia/Taipei')::date = (now() AT TIME ZONE 'Asia/Taipei')::date
      LIMIT 1`,
    [kind],
  );
  return rows.length > 0;
}
