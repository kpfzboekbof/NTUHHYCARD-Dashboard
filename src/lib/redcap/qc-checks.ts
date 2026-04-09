/**
 * Quality Control check logic (server-side only).
 *
 * Metadata constants live in @/config/qc-checks for client-safe imports.
 */

export interface QcFlag {
  studyId: string;
  hospital: string;
  checkId: string;
  category: 'consistency' | 'logic' | 'chronology' | 'outlier' | 'behavior';
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

// ---- per-record checks (A1-A4, B1-B5, C1-C3, E1, E3) ----

export function runRecordChecks(rows: Record<string, string>[]): QcFlag[] {
  const flags: QcFlag[] = [];

  const mainRows = new Map<string, Record<string, string>>();

  for (const row of rows) {
    const id = row.study_id;
    if (!id) continue;

    if (isFilled(row.exclusion) && row.exclusion !== '0') continue;

    if (!row.redcap_repeat_instrument || row.redcap_repeat_instrument === '') {
      mainRows.set(id, row);
    }
  }

  for (const [studyId, r] of mainRows) {
    const hospital = r.hospital || '0';

    // ── A: 重複欄位衝突 (consistency) ──

    // A1: initial_dnr_core vs ini_dnr — 值應相同 (initial_dnr_core=1, ini_dnr=2 視為相容)
    const a1Compatible = r.initial_dnr_core === '1' && r.ini_dnr === '2';
    if (isFilled(r.initial_dnr_core) && isFilled(r.ini_dnr) && r.initial_dnr_core !== r.ini_dnr && !a1Compatible) {
      flags.push({
        studyId, hospital, checkId: 'A1', category: 'consistency', severity: 'error',
        message: `initial_dnr_core=${r.initial_dnr_core}, ini_dnr=${r.ini_dnr}`,
        redcapPage: 'ntuh_nhi_core',
      });
    }

    // A2: mid_dnr_core vs mid_dnr — 值應相同
    if (isFilled(r.mid_dnr_core) && isFilled(r.mid_dnr) && r.mid_dnr_core !== r.mid_dnr) {
      flags.push({
        studyId, hospital, checkId: 'A2', category: 'consistency', severity: 'error',
        message: `mid_dnr_core=${r.mid_dnr_core}, mid_dnr=${r.mid_dnr}`,
        redcapPage: 'ntuh_nhi_core',
      });
    }

    // A3: any_rosc vs (ever_rosc=1 OR prehos_rosc_core=2)
    if (isFilled(r.any_rosc)) {
      const expected = (r.ever_rosc === '1' || r.prehos_rosc_core === '2') ? '1' : '0';
      if (isFilled(r.ever_rosc) && isFilled(r.prehos_rosc_core) && r.any_rosc !== expected) {
        flags.push({
          studyId, hospital, checkId: 'A3', category: 'consistency', severity: 'error',
          message: `any_rosc=${r.any_rosc}, 預期=${expected} (ever_rosc=${r.ever_rosc}, prehos_rosc_core=${r.prehos_rosc_core})`,
          redcapPage: 'ntuh_nhi_outcome',
        });
      }
    }

    // A4: edoutcome_core vs sur_icu — 編碼對應 0↔0, 2↔1, 1↔2
    if (isFilled(r.edoutcome_core) && isFilled(r.sur_icu)) {
      const edToSur: Record<string, string> = { '0': '0', '2': '1', '1': '2' };
      const expectedSurIcu = edToSur[r.edoutcome_core];
      if (expectedSurIcu !== undefined && r.sur_icu !== expectedSurIcu) {
        flags.push({
          studyId, hospital, checkId: 'A4', category: 'consistency', severity: 'error',
          message: `edoutcome_core=${r.edoutcome_core}, sur_icu=${r.sur_icu} (預期 sur_icu=${expectedSurIcu})`,
          redcapPage: 'ntuh_nhi_core',
        });
      }
    }

    // ── B: 邏輯矛盾 (logic) ──

    // B1: prehos_rosc_core = 1 but ever_rosc = 0
    if (isYes(r.prehos_rosc_core) && isFilled(r.ever_rosc) && r.ever_rosc === '0') {
      flags.push({
        studyId, hospital, checkId: 'B1', category: 'logic', severity: 'error',
        message: `到院前 ROSC=是, 但 ever_rosc=否`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // B2: ini_dnr = 1 AND defibrillation = 1
    if (isYes(r.ini_dnr) && isYes(r.defibrillation)) {
      flags.push({
        studyId, hospital, checkId: 'B2', category: 'logic', severity: 'warning',
        message: `初始 DNR=是, 但有電擊記錄`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // B3: sur_icu=0 (急診死亡) but sur_dis=1 (存活出院)
    if (r.sur_icu === '0' && r.sur_dis === '1') {
      flags.push({
        studyId, hospital, checkId: 'B3', category: 'logic', severity: 'error',
        message: `sur_icu=0（急診死亡）, sur_dis=1（存活出院）`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // B4: edoutcome_core=0 (急診死亡) but cpc=1~4
    if (r.edoutcome_core === '0' && isFilled(r.cpc) && ['1','2','3','4'].includes(r.cpc)) {
      flags.push({
        studyId, hospital, checkId: 'B4', category: 'logic', severity: 'error',
        message: `edoutcome_core=0（急診死亡）, cpc=${r.cpc}（非死亡）`,
        redcapPage: 'ntuh_nhi_core',
      });
    }

    // B5: sur_dis=0 (出院死亡) but cpc=1~4
    if (r.sur_dis === '0' && isFilled(r.cpc) && ['1','2','3','4'].includes(r.cpc)) {
      flags.push({
        studyId, hospital, checkId: 'B5', category: 'logic', severity: 'error',
        message: `sur_dis=0（出院死亡）, cpc=${r.cpc}（非死亡）`,
        redcapPage: 'ntuh_nhi_outcome',
      });
    }

    // ── C: 時序矛盾 (chronology) ──

    // C1: currently skipped — er_arrival is a category code, not a timestamp
    // TODO: re-enable if a proper ER arrival timestamp field is identified
    const icuAdTime = parseTime(r.icu_ad_time);

    // C2: hosp_dis_time < icu_ad_time
    const hospDisTime = parseTime(r.hosp_dis_time);
    if (hospDisTime && icuAdTime && hospDisTime < icuAdTime) {
      flags.push({
        studyId, hospital, checkId: 'C2', category: 'chronology', severity: 'error',
        message: `出院 ${fmt(hospDisTime)} 早於 ICU 入院 ${fmt(icuAdTime)}`,
        redcapPage: 'ntuh_nhi_discharge',
      });
    }

    // C3: wlst_time anomalies
    const wlstTime = parseTime(r.wlst_time);
    if (wlstTime) {
      if (icuAdTime && wlstTime < icuAdTime) {
        flags.push({
          studyId, hospital, checkId: 'C3', category: 'chronology', severity: 'error',
          message: `WLST ${fmt(wlstTime)} 早於 ICU 入院 ${fmt(icuAdTime)}`,
          redcapPage: 'ntuh_nhi_outcome',
        });
      }
      if (hospDisTime && wlstTime > hospDisTime) {
        flags.push({
          studyId, hospital, checkId: 'C3', category: 'chronology', severity: 'error',
          message: `WLST ${fmt(wlstTime)} 晚於出院 ${fmt(hospDisTime)}`,
          redcapPage: 'ntuh_nhi_outcome',
        });
      }
    }

    // ── E: 離群值 (outlier) ──

    // E1: duration extreme values
    if (isFilled(r.duration)) {
      const dur = parseFloat(r.duration);
      if (!isNaN(dur)) {
        if (dur === 0) {
          flags.push({
            studyId, hospital, checkId: 'E1', category: 'outlier', severity: 'warning',
            message: `急救時間=0 分鐘`,
            redcapPage: 'ntuh_nhi_outcome',
          });
        } else if (dur > 180) {
          flags.push({
            studyId, hospital, checkId: 'E1', category: 'outlier', severity: 'warning',
            message: `急救時間=${dur} 分鐘 (>180)`,
            redcapPage: 'ntuh_nhi_outcome',
          });
        }
      }
    }

    // E3: EMS-transported, witnessed, but all pre-hospital measures empty/no
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
          studyId, hospital, checkId: 'E3', category: 'outlier', severity: 'warning',
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

// ---- behavior checks (F1, F2) ----

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

  // F1: Burst entry detection — >30 entries in 10-minute window per user
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
          checkId: 'F1', category: 'behavior', severity: 'warning',
          owner: username,
          message: `10 分鐘內填寫 ${windowSize} 筆 (${windowTime} 起)`,
        });
        windowStart = i + 1;
        break;
      }
    }
  }

  // F2: Inactive owners — daysSince > 14 and grade is '落後' or '待加強'
  for (const op of ownerProductivity) {
    if (op.daysSince !== null && op.daysSince > 14 && (op.grade === '落後' || op.grade === '待加強')) {
      flags.push({
        checkId: 'F2', category: 'behavior', severity: 'warning',
        owner: op.owner,
        message: `已 ${op.daysSince} 天未登錄，進度等級：${op.grade}`,
      });
    }
  }

  return flags;
}
