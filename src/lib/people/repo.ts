import { getSql, newId } from '@/lib/db/client';
import { auditQuery, type Actor } from '@/lib/db/audit';
import type { Role } from '@/lib/auth/session';

/**
 * The person registry — one row per human, carrying all three identities they
 * previously had scattered across the system: their REDCap username, their
 * etiology labeler code, and the email they now log in with.
 *
 * Everything downstream joins on `id`. Display names become presentation only,
 * which retires the fragile name→username reverse lookup that silently
 * misattributed work whenever two people shared a name or someone was renamed.
 */

export interface Person {
  id: string;
  redcapUsername: string | null;
  labelerCode: number | null;
  displayName: string;
  email: string;
  roles: Role[];
  broadcastOptOut: boolean;
  notifyPref: string;
  active: boolean;
}

export interface PersonInput {
  redcapUsername?: string | null;
  labelerCode?: number | null;
  displayName: string;
  email: string;
  roles?: Role[];
  broadcastOptOut?: boolean;
  notifyPref?: string;
  active?: boolean;
}

type PersonRow = {
  id: string;
  redcap_username: string | null;
  labeler_code: number | null;
  display_name: string;
  email: string;
  roles: string[];
  broadcast_opt_out: boolean;
  notify_pref: string;
  active: boolean;
};

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    redcapUsername: row.redcap_username,
    labelerCode: row.labeler_code === null ? null : Number(row.labeler_code),
    displayName: row.display_name,
    email: row.email,
    roles: row.roles as Role[],
    broadcastOptOut: row.broadcast_opt_out,
    notifyPref: row.notify_pref,
    active: row.active,
  };
}

const COLUMNS = `id, redcap_username, labeler_code, display_name, email, roles,
                 broadcast_opt_out, notify_pref, active`;

export async function listPeople(includeInactive = false): Promise<Person[]> {
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM person
     WHERE ($1::boolean OR active)
     ORDER BY display_name`,
    [includeInactive],
  );
  return (rows as PersonRow[]).map(toPerson);
}

export async function findById(id: string): Promise<Person | null> {
  const sql = getSql();
  const rows = await sql.query(`SELECT ${COLUMNS} FROM person WHERE id = $1`, [id]);
  return rows.length ? toPerson(rows[0] as PersonRow) : null;
}

/** Login is by email, so match case-insensitively. */
export async function findByEmail(email: string): Promise<Person | null> {
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM person WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows.length ? toPerson(rows[0] as PersonRow) : null;
}

export async function findByRedcapUsername(username: string): Promise<Person | null> {
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM person WHERE redcap_username = $1`,
    [username],
  );
  return rows.length ? toPerson(rows[0] as PersonRow) : null;
}

export async function findByLabelerCode(code: number): Promise<Person | null> {
  const sql = getSql();
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM person WHERE labeler_code = $1`,
    [code],
  );
  return rows.length ? toPerson(rows[0] as PersonRow) : null;
}

export async function createPerson(input: PersonInput, actor: Actor): Promise<Person> {
  const sql = getSql();
  // The id is generated here so the audit row can reference it in the same
  // transaction, with no round trip to read it back.
  const person: Person = {
    id: newId(),
    redcapUsername: input.redcapUsername ?? null,
    labelerCode: input.labelerCode ?? null,
    displayName: input.displayName,
    email: input.email,
    roles: input.roles ?? ['viewer'],
    broadcastOptOut: input.broadcastOptOut ?? false,
    notifyPref: input.notifyPref ?? 'digest',
    active: input.active ?? true,
  };

  await sql.transaction([
    sql`
      INSERT INTO person (id, redcap_username, labeler_code, display_name, email,
                          roles, broadcast_opt_out, notify_pref, active)
      VALUES (${person.id}, ${person.redcapUsername}, ${person.labelerCode},
              ${person.displayName}, ${person.email}, ${person.roles},
              ${person.broadcastOptOut}, ${person.notifyPref}, ${person.active})
    `,
    auditQuery(sql, {
      actor,
      action: 'person.create',
      entityType: 'person',
      entityId: person.id,
      after: person,
    }),
  ]);

  return person;
}

export async function updatePerson(
  id: string,
  changes: Partial<PersonInput>,
  actor: Actor,
): Promise<Person> {
  const before = await findById(id);
  if (!before) throw new Error(`找不到人員 ${id}`);

  const after: Person = {
    ...before,
    redcapUsername: changes.redcapUsername !== undefined ? changes.redcapUsername : before.redcapUsername,
    labelerCode: changes.labelerCode !== undefined ? changes.labelerCode : before.labelerCode,
    displayName: changes.displayName ?? before.displayName,
    email: changes.email ?? before.email,
    roles: changes.roles ?? before.roles,
    broadcastOptOut: changes.broadcastOptOut ?? before.broadcastOptOut,
    notifyPref: changes.notifyPref ?? before.notifyPref,
    active: changes.active ?? before.active,
  };

  const sql = getSql();
  await sql.transaction([
    sql`
      UPDATE person SET
        redcap_username   = ${after.redcapUsername},
        labeler_code      = ${after.labelerCode},
        display_name      = ${after.displayName},
        email             = ${after.email},
        roles             = ${after.roles},
        broadcast_opt_out = ${after.broadcastOptOut},
        notify_pref       = ${after.notifyPref},
        active            = ${after.active},
        updated_at        = now()
      WHERE id = ${id}
    `,
    auditQuery(sql, {
      actor,
      action: 'person.update',
      entityType: 'person',
      entityId: id,
      before,
      after,
    }),
  ]);

  return after;
}
