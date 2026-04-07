export interface QcCheckMeta {
  id: string;
  category: 'consistency' | 'logic' | 'chronology' | 'outlier' | 'behavior';
  severity: 'error' | 'warning';
  label: string;
  description: string;
}

export const QC_CHECK_META: QcCheckMeta[] = [
  { id: 'A1', category: 'consistency', severity: 'error',   label: 'initial_dnr_core vs ini_dnr 不一致', description: '兩欄位皆代表到院即 DNR，值應相同' },
  { id: 'A2', category: 'consistency', severity: 'error',   label: 'mid_dnr_core vs mid_dnr 不一致',     description: '兩欄位皆代表中途簽署 DNR，值應相同' },
  { id: 'A3', category: 'consistency', severity: 'error',   label: 'any_rosc vs ever_rosc/prehos_rosc 不一致', description: 'any_rosc 應等於 ever_rosc=1 或 prehos_rosc_core=2 任一成立' },
  { id: 'A4', category: 'consistency', severity: 'error',   label: 'edoutcome_core vs sur_icu 不一致',   description: '離開急診狀態編碼不一致 (0↔0, 2↔1, 1↔2)' },
  { id: 'B1', category: 'logic',      severity: 'error',   label: '到院前 ROSC vs 結果矛盾',       description: '到院前已 ROSC，但結果記錄從未 ROSC' },
  { id: 'B2', category: 'logic',      severity: 'warning', label: 'DNR 與急救處置矛盾',             description: '初始 DNR 為是，但仍記錄電擊等急救處置' },
  // C1: 暫時停用 — er_arrival 只是類別碼，非時間戳。待確認到院時間欄位名稱後再啟用
  { id: 'C2', category: 'chronology', severity: 'error',   label: '出院時間早於 ICU 入院時間',       description: 'hosp_dis_time 早於 icu_ad_time' },
  { id: 'C3', category: 'chronology', severity: 'error',   label: 'WLST 時間異常',                  description: 'wlst_time 早於 ICU 入院或晚於出院' },
  { id: 'E1', category: 'outlier',    severity: 'warning', label: '急救時間極端值',                  description: 'duration 為 0 或超過 180 分鐘' },
  { id: 'E3', category: 'outlier',    severity: 'warning', label: 'EMS 送入但到院前措施全空',        description: 'EMS 送入、有目擊，但到院前急救措施全部為否/空' },
];

export const BEHAVIOR_CHECK_META: QcCheckMeta[] = [
  { id: 'F1', category: 'behavior', severity: 'warning', label: '短時間大量填寫',  description: '同一使用者在 10 分鐘內填寫超過 30 筆' },
  { id: 'F2', category: 'behavior', severity: 'warning', label: '長期未登錄',       description: '負責人超過 14 天未有任何登錄活動' },
];
