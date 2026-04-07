import { FORMS, FORM_LABEL_MAP, EXAM_FORMS } from '@/config/forms';
import { HOSPITALS } from '@/config/hospitals';
import type {
  CompletionRow, FormStats, OwnerStats, LogEntry,
  OwnerProductivity, OwnerFormProgress, WeeklyTimeline,
  CompletionStatus, OwnerAssignments, User,
} from '@/types';
import type { RawCompletionRecord, RawLogEntry } from './types';

const UNASSIGNED = '未指派';

function resolveOwner(formName: string, assignments: OwnerAssignments, users: User[]): string {
  const username = assignments[formName];
  if (!username) return UNASSIGNED;
  const user = users.find(u => u.username === username);
  return user?.name || username;
}

// --- Completion transforms ---

export interface VirtualFormStatus {
  coreAssistant?: Map<string, boolean>;
  outcomeAssistant?: Map<string, boolean>;
  outcomeEtiologyFinal?: Map<string, boolean>;
}

export function transformCompletion(
  raw: RawCompletionRecord[],
  assignments: OwnerAssignments = {},
  users: User[] = [],
  virtualStatus?: VirtualFormStatus,
  traumaIds?: Set<string>,
): CompletionRow[] {
  const rows: CompletionRow[] = [];

  for (const record of raw) {
    const studyId = record.study_id;
    const hospital = parseInt(record.hospital) || 0;
    const hospitalName = HOSPITALS[hospital] || `院區${hospital}`;
    const excluded = record.exclusion !== '0' && record.exclusion !== '';

    const surIcu = record.sur_icu === '1';

    for (const form of FORMS) {
      // Lab ICU and Postarrest Care only apply to patients admitted to ICU (sur_icu=1)
      const ICU_DEPENDENT_FORMS = ['ntuh_nhi_lab_icu', 'ntuh_nhi_postarrest_care'];
      if (ICU_DEPENDENT_FORMS.includes(form.name) && !surIcu) {
        continue; // skip — not applicable for this patient
      }

      // Trauma form only applies to records with cause_all_etiology_new = 1
      if (form.name === 'h14trauma_ohca_transfusion' && traumaIds && !traumaIds.has(studyId)) {
        continue; // skip — not a trauma case
      }

      let statusCode: CompletionStatus;

      if (form.name === 'ntuh_nhi_core_assistant') {
        const complete = virtualStatus?.coreAssistant?.get(studyId) ?? false;
        statusCode = complete ? 2 : 0;
      } else if (form.name === 'ntuh_nhi_core_doctor') {
        const code = parseInt(record['ntuh_nhi_core_complete']) as CompletionStatus;
        statusCode = ([0, 1, 2].includes(code) ? code : 0) as CompletionStatus;
      } else if (form.name === 'ntuh_nhi_outcome_assistant') {
        const complete = virtualStatus?.outcomeAssistant?.get(studyId) ?? false;
        statusCode = complete ? 2 : 0;
      } else if (form.name === 'ntuh_nhi_outcome_doctor') {
        const code = parseInt(record['ntuh_nhi_outcome_complete']) as CompletionStatus;
        statusCode = ([0, 1, 2].includes(code) ? code : 0) as CompletionStatus;
      } else if (form.name === 'ntuh_nhi_outcome_etiology') {
        const complete = virtualStatus?.outcomeEtiologyFinal?.get(studyId) ?? false;
        statusCode = complete ? 2 : 0;
      } else {
        const key = `${form.name}_complete`;
        const code = parseInt(record[key]) as CompletionStatus;
        statusCode = ([0, 1, 2].includes(code) ? code : 0) as CompletionStatus;
      }

      rows.push({
        studyId,
        hospital,
        hospitalName,
        form: form.name,
        label: form.label,
        owner: resolveOwner(form.name, assignments, users),
        statusCode,
        status: statusCode === 2 ? 'Complete' : statusCode === 1 ? 'Unverified' : 'Incomplete',
        excluded,
      });
    }
  }

  return rows;
}

export function calcFormStats(rows: CompletionRow[]): FormStats[] {
  const validRows = rows.filter(r => !r.excluded);
  const map = new Map<string, FormStats>();

  for (const row of validRows) {
    let s = map.get(row.form);
    if (!s) {
      s = {
        form: row.form,
        label: row.label,
        owner: row.owner,
        total: 0, complete: 0, unverified: 0, incomplete: 0, pctComplete: 0,
      };
      map.set(row.form, s);
    }
    s.total++;
    if (row.statusCode === 2) s.complete++;
    else if (row.statusCode === 1) s.unverified++;
    else s.incomplete++;
  }

  return Array.from(map.values()).map(s => ({
    ...s,
    pctComplete: s.total > 0 ? Math.round(s.complete / s.total * 1000) / 10 : 0,
  }));
}

export function calcOwnerStats(rows: CompletionRow[]): OwnerStats[] {
  const validRows = rows.filter(r => !r.excluded);
  const map = new Map<string, OwnerStats>();

  for (const row of validRows) {
    let s = map.get(row.owner);
    if (!s) {
      s = {
        owner: row.owner,
        totalCells: 0, complete: 0, unverified: 0, incomplete: 0, pctComplete: 0,
        formsCount: 0,
      };
      map.set(row.owner, s);
    }
    s.totalCells++;
    if (row.statusCode === 2) s.complete++;
    else if (row.statusCode === 1) s.unverified++;
    else s.incomplete++;
  }

  const ownerForms = new Map<string, Set<string>>();
  for (const row of validRows) {
    if (!ownerForms.has(row.owner)) ownerForms.set(row.owner, new Set());
    ownerForms.get(row.owner)!.add(row.form);
  }

  return Array.from(map.values()).map(s => ({
    ...s,
    pctComplete: s.totalCells > 0 ? Math.round(s.complete / s.totalCells * 1000) / 10 : 0,
    formsCount: ownerForms.get(s.owner)?.size || 0,
  }));
}

// --- Logging transforms ---

export function transformLogs(raw: RawLogEntry[]): LogEntry[] {
  return raw
    .filter(r =>
      r.action && /Update|Create|Save|更新|建立|儲存/i.test(r.action) && /record|紀錄/i.test(r.action)
    )
    .map(r => {
      // Try [formName] in action first, then look for _complete in details
      const formMatch = r.action.match(/\[([^\]]+)\]/);
      let formParsed: string | undefined;
      if (formMatch) {
        formParsed = formMatch[1].toLowerCase().trim();
      } else if (r.details) {
        const completeMatch = r.details.match(/(\w+)_complete\s*=/);
        if (completeMatch) {
          formParsed = completeMatch[1].toLowerCase().trim();
        }
      }
      return {
        timestamp: r.timestamp,
        username: r.username,
        action: r.action,
        details: r.details || '',
        record: r.record,
        formParsed,
      };
    });
}

export function calcLoggingStats(
  logs: LogEntry[],
  completionRows: CompletionRow[],
  monthsBack: number = 3,
  assignments: OwnerAssignments = {},
  users: User[] = [],
  targetIds?: { basic: number | null; exam: number | null },
): {
  byOwner: OwnerProductivity[];
  byOwnerForm: OwnerFormProgress[];
  timeline: WeeklyTimeline[];
} {
  if (logs.length === 0) {
    return { byOwner: [], byOwnerForm: [], timeline: [] };
  }

  // Build reverse map: owner display name → username
  const nameToUsername = new Map<string, string>();
  for (const [formName, username] of Object.entries(assignments)) {
    const name = resolveOwner(formName, assignments, users);
    if (name !== UNASSIGNED && !nameToUsername.has(name)) {
      nameToUsername.set(name, username);
    }
  }

  // Build username → display name map for timeline
  const usernameToName = new Map<string, string>();
  for (const u of users) {
    usernameToName.set(u.username, u.name);
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  // Per-user log stats (keyed by username)
  const userStats = new Map<string, { count: number; lastEntry: Date }>();
  for (const log of logs) {
    const ts = new Date(log.timestamp);
    if (ts < cutoff) continue;
    const u = userStats.get(log.username);
    if (!u) {
      userStats.set(log.username, { count: 1, lastEntry: ts });
    } else {
      u.count++;
      if (ts > u.lastEntry) u.lastEntry = ts;
    }
  }

  // Complete count per owner per form (from completion data)
  const ownerFormComplete = new Map<string, number>();
  for (const row of completionRows) {
    if (row.statusCode === 2) {
      const key = `${row.owner}|${row.form}`;
      ownerFormComplete.set(key, (ownerFormComplete.get(key) || 0) + 1);
    }
  }

  // Owner productivity
  const byOwner: OwnerProductivity[] = [];
  const ownerForms = new Map<string, typeof FORMS>();
  for (const row of completionRows) {
    const form = FORMS.find(f => f.name === row.form);
    if (!form) continue;
    if (!ownerForms.has(row.owner)) ownerForms.set(row.owner, []);
    const arr = ownerForms.get(row.owner)!;
    if (!arr.find(f => f.name === form.name)) arr.push(form);
  }

  for (const [owner, forms] of ownerForms) {
    const totalTarget = forms.reduce((s, f) => {
      const isExam = EXAM_FORMS.includes(f.name);
      const tid = isExam ? targetIds?.exam : targetIds?.basic;
      return s + (tid ?? f.target);
    }, 0);
    const totalComplete = forms.reduce(
      (s, f) => s + (ownerFormComplete.get(`${owner}|${f.name}`) || 0), 0
    );
    const pctComplete = totalTarget > 0 ? Math.round(totalComplete / totalTarget * 1000) / 10 : 0;

    // Look up log stats by username (reverse lookup from owner display name)
    const username = nameToUsername.get(owner);
    const uStats = username ? userStats.get(username) : undefined;
    const daysSince = uStats
      ? Math.round((now.getTime() - uStats.lastEntry.getTime()) / 86400000)
      : null;

    let grade: OwnerProductivity['grade'];
    if (pctComplete >= 90) grade = '優';
    else if (pctComplete >= 60) grade = '良';
    else if (pctComplete >= 30) grade = '待加強';
    else grade = '落後';

    byOwner.push({
      owner,
      formsCount: forms.length,
      totalTarget,
      totalComplete,
      pctComplete,
      entriesPeriod: uStats?.count || 0,
      lastEntry: uStats ? uStats.lastEntry.toISOString() : null,
      daysSince,
      grade,
    });
  }

  // By owner × form
  const byOwnerForm: OwnerFormProgress[] = [];
  for (const [owner, forms] of ownerForms) {
    for (const f of forms) {
      const completed = ownerFormComplete.get(`${owner}|${f.name}`) || 0;
      byOwnerForm.push({
        owner,
        form: f.name,
        label: f.label,
        target: (() => { const isExam = EXAM_FORMS.includes(f.name); return (isExam ? targetIds?.exam : targetIds?.basic) ?? f.target; })(),
        completed,
        pct: (() => { const isExam = EXAM_FORMS.includes(f.name); const t = (isExam ? targetIds?.exam : targetIds?.basic) ?? f.target; return t > 0 ? Math.round(completed / t * 1000) / 10 : 0; })(),
      });
    }
  }

  // Daily timeline — use display names, match monthsBack range
  const timelineCutoff = new Date(now);
  timelineCutoff.setMonth(timelineCutoff.getMonth() - monthsBack);

  const dayMap = new Map<string, number>();
  for (const log of logs) {
    const ts = new Date(log.timestamp);
    if (ts < timelineCutoff) continue;
    const day = ts.toISOString().slice(0, 10); // YYYY-MM-DD
    const displayName = usernameToName.get(log.username) || log.username;
    const key = `${displayName}|${day}`;
    dayMap.set(key, (dayMap.get(key) || 0) + 1);
  }

  const timeline: WeeklyTimeline[] = Array.from(dayMap.entries()).map(([key, entries]) => {
    const [username, week] = key.split('|');
    return { username, week, entries };
  });

  return { byOwner, byOwnerForm, timeline };
}
