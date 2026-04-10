export type CompletionStatus = 0 | 1 | 2;

export interface CompletionRow {
  studyId: string;
  hospital: number;
  hospitalName: string;
  form: string;
  label: string;
  owner: string;
  statusCode: CompletionStatus;
  status: 'Incomplete' | 'Unverified' | 'Complete';
  excluded: boolean;
}

export interface FormStats {
  form: string;
  label: string;
  owner: string;
  total: number;
  complete: number;
  unverified: number;
  incomplete: number;
  pctComplete: number;
}

export interface OwnerStats {
  owner: string;
  totalCells: number;
  complete: number;
  unverified: number;
  incomplete: number;
  pctComplete: number;
  formsCount: number;
}

export interface LogEntry {
  timestamp: string;
  username: string;
  action: string;
  details: string;
  record?: string;
  formParsed?: string;
}

export interface OwnerProductivity {
  owner: string;
  formsCount: number;
  totalTarget: number;
  totalComplete: number;
  pctComplete: number;
  entriesPeriod: number;
  lastEntry: string | null;
  daysSince: number | null;
  grade: '優' | '良' | '待加強' | '落後';
}

export interface OwnerFormProgress {
  owner: string;
  form: string;
  label: string;
  target: number;
  completed: number;
  pct: number;
}

export interface WeeklyTimeline {
  username: string;
  week: string;
  entries: number;
}

export interface Filters {
  owner: string;
  hospital: string;
  timeRange: 'week' | 'month' | '3months' | '6months' | 'all';
}

export interface FormConfig {
  name: string;
  label: string;
  target: number;
}

export interface User {
  username: string;
  name: string;
}

export type OwnerAssignments = Record<string, string>;

export interface CompletionResponse {
  rows: CompletionRow[];
  byForm: FormStats[];
  byOwner: OwnerStats[];
  users: User[];
  assignments: OwnerAssignments;
  hiddenForms: string[];
  targetIds: { basic: number | null; exam: number | null };
  totalRecords: number;
  validOhcaCount: number;
  fetchedAt: string;
}

export interface LoggingResponse {
  byOwner: OwnerProductivity[];
  byOwnerForm: OwnerFormProgress[];
  timeline: WeeklyTimeline[];
  fetchedAt: string;
}

export interface QcRecordFlag {
  studyId: string;
  hospital: string;
  checkId: string;
  category: 'consistency' | 'logic' | 'chronology' | 'outlier' | 'behavior';
  severity: 'error' | 'warning';
  message: string;
  redcapPage: string;
}

export interface QcBehaviorFlag {
  checkId: string;
  category: 'behavior';
  severity: 'warning';
  owner: string;
  message: string;
}

export interface QcResponse {
  recordFlags: QcRecordFlag[];
  behaviorFlags: QcBehaviorFlag[];
  fetchedAt: string;
}

// ============================================================
// Screening (OHCA 病人擷取)
// ============================================================
export type OhcaClass =
  | 'OHCA'
  | 'Prehospital_ROSC'
  | 'Possible_OHCA'
  | 'Manual_Review'
  | 'Not_OHCA';

export type ReviewDecision = 'confirmed' | 'excluded' | null;

export interface ScreeningPatient {
  id: string;
  site: string;
  siteName: string;
  displayGroup: '總院' | '新竹' | '雲林';
  chartNo: string;
  name: string;
  sex: string;
  age: string;
  birthday: string;
  regDate: string;
  triage: string;
  disposition: string;
  lastStatus: string;
  diagnosis: string;
  diagnosisFull: string;
  statOrders: string;
  statDrugs: string;
  chiefComplaint: string;
  presentIllness: string;
  vitalSigns: Record<string, string>;
  ohcaClass: OhcaClass;
  reviewed: ReviewDecision;
  reviewedAt?: string;
}

export interface ScreeningResponse {
  month: string;
  dates: string[];
  /** 每個院區已掃描的日期列表（YYYY-MM-DD） */
  scannedByGroup: Record<'總院' | '新竹' | '雲林', string[]>;
  patients: ScreeningPatient[];
  availableMonths: string[];
  fetchedAt: string;
}
