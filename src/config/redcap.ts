/** REDCap instance links (client-safe). Single source for the hardcoded URL
 * that used to be copied into the QC page, the incomplete list, the etiology
 * page and the reminder email template. */
export const REDCAP_DATA_ENTRY_BASE =
  'https://redcap.ntuh.gov.tw/redcap_v16.1.9/DataEntry/index.php?pid=8207';

/** Direct link to a record's data-entry page. */
export function redcapRecordUrl(studyId: string, page: string): string {
  return `${REDCAP_DATA_ENTRY_BASE}&id=${studyId}&page=${page}`;
}
