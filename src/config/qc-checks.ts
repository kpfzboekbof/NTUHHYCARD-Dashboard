export interface QcCheckMeta {
  id: string;
  category: 'logic' | 'chronology' | 'outlier' | 'behavior';
  severity: 'error' | 'warning';
  label: string;
  description: string;
}

export const QC_CHECK_META: QcCheckMeta[] = [
  { id: 'A1', category: 'logic',      severity: 'error',   label: '到院前 ROSC vs 結果矛盾',       description: '到院前已 ROSC，但結果記錄從未 ROSC' },
  { id: 'A2', category: 'logic',      severity: 'warning', label: 'DNR 與急救處置矛盾',             description: '初始 DNR 為是，但仍記錄電擊等急救處置' },
  { id: 'A3', category: 'logic',      severity: 'error',   label: 'ICU 依賴表單 vs sur_icu 矛盾',   description: '未入 ICU 但 Lab ICU / Postarrest Care 已填寫' },
  { id: 'B1', category: 'chronology', severity: 'error',   label: 'ICU 入院時間早於到院時間',        description: 'icu_ad_time 早於 er_arrival 時間' },
  { id: 'B2', category: 'chronology', severity: 'error',   label: '出院時間早於 ICU 入院時間',       description: 'hosp_dis_time 早於 icu_ad_time' },
  { id: 'B3', category: 'chronology', severity: 'error',   label: 'WLST 時間異常',                  description: 'wlst_time 早於 ICU 入院或晚於出院' },
  { id: 'D1', category: 'outlier',    severity: 'warning', label: '急救時間極端值',                  description: 'duration 為 0 或超過 180 分鐘' },
  { id: 'D3', category: 'outlier',    severity: 'warning', label: 'EMS 送入但到院前措施全空',        description: 'EMS 送入、有目擊，但到院前急救措施全部為否/空' },
];

export const BEHAVIOR_CHECK_META: QcCheckMeta[] = [
  { id: 'E1', category: 'behavior', severity: 'warning', label: '短時間大量填寫',  description: '同一使用者在 10 分鐘內填寫超過 30 筆' },
  { id: 'E2', category: 'behavior', severity: 'warning', label: '長期未登錄',       description: '負責人超過 14 天未有任何登錄活動' },
];
