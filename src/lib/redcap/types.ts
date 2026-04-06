export interface RawCompletionRecord {
  study_id: string;
  hospital: string;
  [key: string]: string;
}

export interface RawLogEntry {
  timestamp: string;
  username: string;
  action: string;
  details: string;
  record?: string;
}

export interface RawUser {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
}
