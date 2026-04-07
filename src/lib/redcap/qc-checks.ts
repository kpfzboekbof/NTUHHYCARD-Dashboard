/**
 * Quality Control check logic (server-side only).
 *
 * Metadata constants live in @/config/qc-checks for client-safe imports.
 */

export interface QcFlag {
  studyId: string;
  hospital: string;
  checkId: string;
  category: 'logic' | 'chronology' | 'outlier' | 'behavior';
  severity: 'error' | 'warning';
  message: string;
  redcapPage: string;
}

// ---- helpers ----

function isFilled(val: string | undefined): boolean {
  return val !== undefined && val !== '';
}

function isYes(val: string | undefined): boolean {
  return val === '1';
}

function parseTime(val: string | undefined): Date | null {
  if (!val || val === '') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ---- per-record checks (A1-A3, B1-B3, D1, D3) ----

export function runRecordChecks(rows: Record<string, string>[]): QcFlag[] {
  const flags: QcFlag[] = [];

  const mainRows = new Map<string, Record<string, string>>();
  const labIcuCompleted = new Set<string>();
  const postarrestCompleted = new Set<string>();

  for (const row of rows) {
    const id = row.study_id;
    if (!id) continue;

    if (isFilled(row.exclusion) && row.exclusion !== '0') continue;

    if (!row.redcap_repeat_instrument || row.redcap_repeat_instrument === '') {
      mainRows.set(id, row);
    }

    if (row.ntuh_nhi_lab_icu_complete && row.ntuh_nhi_lab_icu_complete !== '' && row.ntuh_nhi_lab_icu_complete !== '0') {
      labIcuCompleted.add(id);
    }
    if (row.ntuh_nhi_postarrest_care_complete && row.ntuh_nhi_postarrest_care_complete !== '' && row.ntuh_nhi_postarrest_care_complete !== '0') {
      postarrestCompleted.add(id);
    }
  }

  for (const [studyId, r] of mainRows) {
    const hospital = r.hospital || '0';

    // A1: prehos_rosc_core = 1 but ever_rosc = 0
    if (isYes(r.prehos_rosc_core) && isFilled(r.ever_rosc) && r.ever_rosc === '0') {
      flags.push({
        studyId, hospital, checkId: 'A1', category: 'logic', severity: 'error',
        message: `到院前 ROSC=是, 但 ever_rosc=否`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // A2: ini_dnr = 1 AND defibrillation = 1
    if (isYes(r.ini_dnr) && isYes(r.defibrillation)) {
      flags.push({
        studyId, hospital, checkId: 'A2', category: 'logic', severity: 'warning',
        message: `初始 DNR=是, 但有電擊記錄`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // A3: sur_icu != 1 but Lab ICU or Postarrest Care has data
    if (r.sur_icu !== '1') {
      if (labIcuCompleted.has(studyId)) {
        flags.push({
          studyId, hospital, checkId: 'A3', category: 'logic', severity: 'error',
          message: `sur_icu≠1, 但 Lab ICU 表單有填寫`,
          redcapPage: 'ntuh_nhi_lab_icu',
        });
      }
      if (postarrestCompleted.has(studyId)) {
        flags.push({
          studyId, hospital, checkId: 'A3', category: 'logic', severity: 'error',
          message: `sur_icu≠1, 但 Postarrest Care 表單有填寫`,
          redcapPage: 'ntuh_nhi_postarrest_care',
        });
      }
    }

    // B1: currently skipped — er_arrival is a category code, not a timestamp
    // TODO: re-enable if a proper ER arrival timestamp field is identified
    const icuAdTime = parseTime(r.icu_ad_time);

    // B2: hosp_dis_time < icu_ad_time
    const hospDisTime = parseTime(r.hosp_dis_time);
    if (hospDisTime && icuAdTime && hospDisTime < icuAdTime) {
      flags.push({
        studyId, hospital, checkId: 'B2', category: 'chronology', severity: 'error',
        message: `出院 ${fmt(hospDisTime)} 早於 ICU 入院 ${fmt(icuAdTime)}`,
        redcapPage: 'ntuh_nhi_discharge',
      });
    }

    // B3: wlst_time anomalies
    const wlstTime = parseTime(r.wlst_time);
    if (wlstTime) {
      if (icuAdTime && wlstTime < icuAdTime) {
        flags.push({
          studyId, hospital, checkId: 'B3', category: 'chronology', severity: 'error',
          message: `WLST ${fmt(wlstTime)} 早於 ICU 入院 ${fmt(icuAdTime)}`,
          redcapPage: 'ntuh_nhi_outcome',
        });
      }
      if (hospDisTime && wlstTime > hospDisTime) {
        flags.push({
          studyId, hospital, checkId: 'B3', category: 'chronology', severity: 'error',
          message: `WLST ${fmt(wlstTime)} 晚於出院 ${fmt(hospDisTime)}`,
          redcapPage: 'ntuh_nhi_outcome',
        });
      }
    }

    // D1: duration extreme values
    if (isFilled(r.duration)) {
      const dur = parseFloat(r.duration);
      if (!isNaN(dur)) {
        if (dur === 0) {
          flags.push({
            studyId, hospital, checkId: 'D1', category: 'outlier', severity: 'warning',
            message: `急救時間=0 分鐘`,
            redcapPage: 'ntuh_nhi_outcome',
          });
        } else if (dur > 180) {
          flags.push({
            studyId, hospital, checkId: 'D1', category: 'outlier', severity: 'warning',
            message: `急救時間=${dur} 分鐘 (>180)`,
            redcapPage: 'ntuh_nhi_outcome',
          });
        }
      }
    }

    // D3: EMS-transported, witnessed, but all pre-hospital measures empty/no
    const isEms = isYes(r.emt_core) || isYes(r.emtp_core);
    const isWitnessed = isYes(r.witnessed_core);
    if (isEms && isWitnessed) {
      const allEmpty =
        !isYes(r.bystander_core) &&
        !isYes(r.pad_core) &&
        !isYes(r.manual_core) &&
        !isYes(r.mcc_core) &&
        !isYes(r.aed_core);
      if (allEmpty) {
        flags.push({
          studyId, hospital, checkId: 'D3', category: 'outlier', severity: 'warning',
          message: `EMS 送入、有目擊，但到院前急救措施全為否/空`,
          redcapPage: 'ntuh_nhi_core',
        });
      }
    }
  }

  return flags;
}

function fmt(d: Date): string {
  return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---- behavior checks (E1, E2) ----

export interface BehaviorFlag {
  checkId: string;
  category: 'behavior';
  severity: 'warning';
  owner: string;
  message: string;
}

export interface LogRow {
  timestamp: string;
  username: string;
}

export function runBehaviorChecks(
  logs: LogRow[],
  ownerProductivity: Array<{ owner: string; daysSince: number | null; grade: string }>,
): BehaviorFlag[] {
  const flags: BehaviorFlag[] = [];

  // E1: Burst entry detection — >30 entries in 10-minute window per user
  const byUser = new Map<string, Date[]>();
  for (const log of logs) {
    const ts = new Date(log.timestamp);
    if (isNaN(ts.getTime())) continue;
    if (!byUser.has(log.username)) byUser.set(log.username, []);
    byUser.get(log.username)!.push(ts);
  }

  for (const [username, timestamps] of byUser) {
    timestamps.sort((a, b) => a.getTime() - b.getTime());
    let windowStart = 0;
    for (let i = 0; i < timestamps.length; i++) {
      while (timestamps[i].getTime() - timestamps[windowStart].getTime() > 10 * 60 * 1000) {
        windowStart++;
      }
      const windowSize = i - windowStart + 1;
      if (windowSize > 30) {
        const windowTime = timestamps[windowStart].toLocaleDateString('zh-TW', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        flags.push({
          checkId: 'E1', category: 'behavior', severity: 'warning',
          owner: username,
          message: `10 分鐘內填寫 ${windowSize} 筆 (${windowTime} 起)`,
        });
        windowStart = i + 1;
        break;
      }
    }
  }

  // E2: Inactive owners — daysSince > 14 and grade is '落後' or '待加強'
  for (const op of ownerProductivity) {
    if (op.daysSince !== null && op.daysSince > 14 && (op.grade === '落後' || op.grade === '待加強')) {
      flags.push({
        checkId: 'E2', category: 'behavior', severity: 'warning',
        owner: op.owner,
        message: `已 ${op.daysSince} 天未登錄，進度等級：${op.grade}`,
      });
    }
  }

  return flags;
}
