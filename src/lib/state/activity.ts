import type { LogEntry, OwnerAssignments } from '@/types';
import { parseRedcapTimestamp } from '@/lib/redcap/timestamp';
import { ownersForUnits } from './ownership';
import { countsAsDone, type ProgressUnitRef, type RedcapActivity } from './progress';
import type { RecordDerivation } from './types';

/**
 * What REDCap's own log says about who did the work — joined on the REDCap
 * username, never on a display name.
 *
 * The old path reversed a display name back into a username
 * (`transform.ts:203-209`), which silently picked one account whenever two
 * people share a name. This registry has exactly that case: 熊墨樺 holds both
 * `g07470` and `mohua0820`, so one of the two accounts' entries vanished from
 * the productivity numbers. Usernames are what REDCap logs, so usernames are
 * what we key on.
 *
 * See docs/management-system-redesign.md §9.1（Credit 歸屬）.
 */

export interface SaveEvent {
  studyId: string;
  /** REDCap instrument name, or null when the log line never named one. */
  form: string | null;
  username: string;
  at: Date;
}

/** The log lines that are a save against a known record, in a usable shape. */
export function collectSaveEvents(logs: LogEntry[]): SaveEvent[] {
  const events: SaveEvent[] = [];
  for (const log of logs) {
    if (!log.record || !log.username) continue;
    const at = parseRedcapTimestamp(log.timestamp);
    if (!at) continue;
    events.push({ studyId: log.record, form: log.formParsed ?? null, username: log.username, at });
  }
  return events;
}

export interface ActivityOptions {
  /** Saves inside this many days count towards the stalled flag. Design: 14. */
  windowDays?: number;
  now?: Date;
}

export interface ActivitySummary {
  byUsername: Map<string, RedcapActivity>;
  /** The oldest save in the export — how far back any of this can see. */
  exportStart: string | null;
}

/**
 * Per-username activity for the progress model.
 *
 * `count` is deliberately windowed while `lastEntryAt` is not: the stalled flag
 * asks "has this person done anything lately", and the timestamp answers "when
 * did I last see them at all". Somebody who stopped two months ago must show
 * both — a single windowed number would render them identical to somebody who
 * never appears in the export, and the two need different follow-up.
 */
export function summarizeActivity(logs: LogEntry[], options: ActivityOptions = {}): ActivitySummary {
  const { windowDays = 14, now = new Date() } = options;
  const cutoff = now.getTime() - windowDays * 86_400_000;

  // Latest and count are tracked in milliseconds and rendered once at the end;
  // re-parsing the stored ISO string on every log line would be tens of
  // thousands of Date allocations for a running maximum.
  const running = new Map<string, { latest: number; count: number }>();
  let earliest: number | null = null;

  for (const event of collectSaveEvents(logs)) {
    const ms = event.at.getTime();
    if (earliest === null || ms < earliest) earliest = ms;

    const inWindow = ms >= cutoff ? 1 : 0;
    const current = running.get(event.username);
    if (!current) running.set(event.username, { latest: ms, count: inWindow });
    else {
      current.count += inWindow;
      if (ms > current.latest) current.latest = ms;
    }
  }

  const byUsername = new Map<string, RedcapActivity>(
    [...running.entries()].map(([username, { latest, count }]) => [
      username, { lastEntryAt: new Date(latest).toISOString(), count },
    ]),
  );

  return { byUsername, exportStart: earliest === null ? null : new Date(earliest).toISOString() };
}

/** Last person to save each record+form, keyed `studyId|form`. */
export function lastSaverByRecordForm(logs: LogEntry[]): Map<string, SaveEvent> {
  return lastSaverOf(collectSaveEvents(logs));
}

function lastSaverOf(events: SaveEvent[]): Map<string, SaveEvent> {
  const last = new Map<string, SaveEvent>();
  for (const event of events) {
    if (!event.form) continue;
    const key = `${event.studyId}|${event.form}`;
    const current = last.get(key);
    if (!current || event.at.getTime() > current.at.getTime()) last.set(key, event);
  }
  return last;
}

export interface CreditUnitRef extends ProgressUnitRef {
  /** REDCap instrument the unit's data lives in. */
  redcapForm: string;
}

export interface OtherSaver {
  username: string;
  count: number;
}

export interface OwnerCredit {
  username: string;
  /** Cells this owner is credited with finishing — the same rule as the score. */
  completed: number;
  /** …the log says they saved themselves. */
  selfSaved: number;
  /** …the log says somebody else saved last. */
  otherSaved: number;
  otherSavers: OtherSaver[];
  /** …no save for that record+form inside the exported log window. */
  unattributed: number;
  /** …on an instrument more than one unit shares, so the log cannot tell which. */
  sharedForm: number;
}

export interface CreditInput {
  records: RecordDerivation[];
  units: CreditUnitRef[];
  assignments: OwnerAssignments;
  logs: LogEntry[];
}

export interface CreditSummary {
  byOwner: Map<string, OwnerCredit>;
  /** Saves that named an instrument, and so could be attributed at all. */
  attributableSaves: number;
  /** Saves whose log line named no instrument — attribution's blind spot. */
  formlessSaves: number;
  exportStart: string | null;
}

function emptyCredit(username: string): OwnerCredit {
  return {
    username, completed: 0, selfSaved: 0, otherSaved: 0,
    otherSavers: [], unattributed: 0, sharedForm: 0,
  };
}

/**
 * Who actually finished the work that is credited to each owner.
 *
 * This never touches state or the score; it answers one management question —
 * is the person named on a unit the person doing it? The honest bit is what it
 * refuses to claim:
 *
 * - Two units on one instrument (Core 助理 and Core 醫師 both live in
 *   `ntuh_nhi_core`) cannot be told apart from a form-level save, and the
 *   doctor's sign-off is always the later save. Attributing anyway would flag
 *   every assistant as not doing their own work, so those cells go to
 *   `sharedForm` and are reported as unknown rather than guessed.
 * - A cell finished before the exported log window has no save to point at, so
 *   it lands in `unattributed`. `exportStart` says how far back we can see.
 */
export function attributeCredit(input: CreditInput): CreditSummary {
  const { records, units, assignments, logs } = input;

  const unitsPerForm = new Map<string, number>();
  for (const unit of units) {
    unitsPerForm.set(unit.redcapForm, (unitsPerForm.get(unit.redcapForm) ?? 0) + 1);
  }

  const ownerByUnit = ownersForUnits(units, assignments);
  const unitById = new Map(units.filter(u => ownerByUnit.has(u.unitId)).map(u => [u.unitId, u]));

  const events = collectSaveEvents(logs);
  const lastSaver = lastSaverOf(events);
  const byOwner = new Map<string, OwnerCredit>();
  const others = new Map<string, Map<string, number>>();

  for (const record of records) {
    for (const cell of record.cells) {
      const owner = ownerByUnit.get(cell.unitId);
      if (!owner) continue;
      const unit = unitById.get(cell.unitId)!;
      if (!countsAsDone(cell.state, unit.kind)) continue;

      let credit = byOwner.get(owner);
      if (!credit) byOwner.set(owner, credit = emptyCredit(owner));
      credit.completed++;

      if ((unitsPerForm.get(unit.redcapForm) ?? 0) > 1) {
        credit.sharedForm++;
        continue;
      }

      const saver = lastSaver.get(`${record.studyId}|${unit.redcapForm}`);
      if (!saver) {
        credit.unattributed++;
      } else if (saver.username === owner) {
        credit.selfSaved++;
      } else {
        credit.otherSaved++;
        let tally = others.get(owner);
        if (!tally) others.set(owner, tally = new Map());
        tally.set(saver.username, (tally.get(saver.username) ?? 0) + 1);
      }
    }
  }

  for (const [owner, tally] of others) {
    byOwner.get(owner)!.otherSavers = [...tally.entries()]
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
  }

  let attributableSaves = 0;
  let earliest: number | null = null;
  for (const event of events) {
    if (event.form !== null) attributableSaves++;
    const ms = event.at.getTime();
    if (earliest === null || ms < earliest) earliest = ms;
  }

  return {
    byOwner,
    attributableSaves,
    formlessSaves: events.length - attributableSaves,
    exportStart: earliest === null ? null : new Date(earliest).toISOString(),
  };
}
