import type { FormConfig } from '@/types';

export const FORMS: FormConfig[] = [
  { name: 'ntuh_nhi_patient',            label: 'Patient',          target: 6000 },
  { name: 'ntuh_nhi_basic_info_38971b',  label: 'Basic Info',       target: 6000 },
  { name: 'ntuh_nhi_predisease',         label: 'Pre-Disease',      target: 6000 },
  { name: 'ntuh_nhi_preohca_hos_use',    label: 'Pre-OHCA Hos Use', target: 6000 },
  { name: 'ntuh_nhi_core_assistant',     label: 'Core 助理',       target: 6000 },
  { name: 'ntuh_nhi_core_doctor',        label: 'Core 醫師',       target: 6000 },
  { name: 'ntuh_nhi_core_cpr',          label: 'Core CPR',         target: 6000 },
  { name: 'h14trauma_ohca_transfusion', label: 'Trauma',           target: 2000 },
  { name: 'ntuh_nhi_lab_ed',            label: 'Lab ED',           target: 6000 },
  { name: 'ntuh_nhi_lab_icu',           label: 'Lab ICU',          target: 6000 },
  { name: 'ntuh_nhi_postarrest_care',   label: 'Postarrest Care',  target: 6000 },
  { name: 'ntuh_nhi_examcheck',         label: 'Exam Check',       target: 6000 },
  { name: 'ntuh_exam_cag',              label: 'CAG',              target: 1500 },
  { name: 'ntuh_exam_ucg',              label: 'UCG',              target: 3000 },
  { name: 'ntuh_exam_abd_echo',         label: 'Abd Echo',         target: 2000 },
  { name: 'ntuh_exam_pes',              label: 'PES',              target: 1000 },
  { name: 'ntuh_exam_colon',            label: 'Colon',            target: 500 },
  { name: 'ntuh_nhi_op',               label: 'OP',               target: 2000 },
  { name: 'ntuh_exam_patho',           label: 'Patho',            target: 500 },
  { name: 'ntuh_exam_lft_2',           label: 'LFT',              target: 1000 },
  { name: 'ntuh_exam_eeg',             label: 'EEG',              target: 1000 },
  { name: 'ntuh_exam_holtertreadmill', label: 'Holter/Treadmill', target: 1000 },
  { name: 'ntuh_nhi_etiology',         label: 'Etiology',         target: 6000 },
  { name: 'ntuh_nhi_outcome_assistant', label: 'Outcome 助理',    target: 6000 },
  { name: 'ntuh_nhi_outcome_doctor',    label: 'Outcome 醫師',    target: 6000 },
  { name: 'ntuh_nhi_outcome_etiology',  label: 'Outcome 死因',    target: 6000 },
  { name: 'ntuh_nhi_discharge',        label: 'Discharge',        target: 6000 },
  { name: 'h6_validation_add',         label: 'Validation',       target: 6000 },
  { name: 'h12_ed_manage_short_outcome', label: 'ED Manage',      target: 6000 },
  { name: 'ntuh_nhi_environment',       label: 'Environment',     target: 6000 },
  { name: 'h20_mtdna',                 label: 'mtDNA',            target: 300 },
];

/** Virtual form names that don't have a direct _complete field in REDCap */
export const VIRTUAL_FORMS = [
  'ntuh_nhi_core_assistant', 'ntuh_nhi_core_doctor',
  'ntuh_nhi_outcome_assistant', 'ntuh_nhi_outcome_doctor', 'ntuh_nhi_outcome_etiology',
];

/** Real REDCap form names used for _complete field lookups */
export const REDCAP_FORM_NAMES = FORMS
  .filter(f => !VIRTUAL_FORMS.includes(f.name))
  .map(f => f.name);

/** Core 助理: required fields in range 76-103 */
export const CORE_ASSISTANT_REQUIRED_FIELDS = [
  'place_core', 'witnessed_core',
  'bystander_core', 'pad_core',
  'manual_core', 'mcc_core',
  'aed_core',
  'airway_core', // checkbox — at least one option checked
  'bosmin_core',
  'emt_core', 'emtp_core', 'prehos_rosc_core',
];

/** Fields that are checkboxes (need special handling in CSV) */
export const CORE_ASSISTANT_CHECKBOX_FIELDS = ['airway_core'];

/** Outcome 助理: required fields (excluding ed_ett, wlst, wlst_type, wlst_time, cpc, etiology_final, cpr_place, icu_ad_time, hosp_dis_time) */
export const OUTCOME_ASSISTANT_REQUIRED_FIELDS = [
  'ini_dnr', 'mid_dnr',
  'defibrillation', 'ever_rosc', 'any_rosc',
  'duration', 'sur_icu',
  'sur_dis',
  'back_ed', 'back_opd', 'back_ward', 'cost',
];

export const FORM_NAMES = FORMS.map(f => f.name);
export const FORM_LABEL_MAP = Object.fromEntries(FORMS.map(f => [f.name, f.label]));

/** 檢查表單 */
export const EXAM_FORMS = [
  'ntuh_exam_cag', 'ntuh_exam_ucg', 'ntuh_exam_abd_echo',
  'ntuh_exam_pes', 'ntuh_exam_colon', 'ntuh_nhi_op',
  'ntuh_exam_patho', 'ntuh_exam_lft_2', 'ntuh_exam_eeg',
  'ntuh_exam_holtertreadmill',
];

/** 基本表單 = 所有表單 - 檢查表單 */
export const BASIC_FORMS = FORM_NAMES.filter(f => !EXAM_FORMS.includes(f));

export type FormCategory = 'basic' | 'exam';

export function getFormCategory(formName: string): FormCategory {
  return EXAM_FORMS.includes(formName) ? 'exam' : 'basic';
}
