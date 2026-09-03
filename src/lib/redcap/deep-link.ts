import { getCachedAsync, setCached } from '@/lib/cache';
import { fetchProjectInfo, fetchRedcapVersion } from './client';

/**
 * REDCap data-entry deep links, built from the version REDCap reports.
 *
 * The version is part of the path (`/redcap_v17.4.1/DataEntry/index.php`), so a
 * REDCap upgrade silently breaks every link that pins it. That had already
 * happened: the pinned 16.1.9 path returns 404 while the server runs 17.4.1, so
 * every "open in REDCap" in the dashboard was dead. Reading the version from
 * the API means the next upgrade fixes itself.
 */

const CACHE_KEY = 'redcap_link_base';
const CACHE_TTL_SECONDS = 86_400;

/**
 * Last-resort fallback if the version cannot be read and nothing is cached.
 * The synced value always wins; this only avoids leaving the UI with no link.
 */
const FALLBACK_VERSION = '17.4.1';
const FALLBACK_PID = '8207';

function redcapOrigin(): string {
  const apiUrl = process.env.REDCAP_URL || 'https://redcap.ntuh.gov.tw/api/';
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'https://redcap.ntuh.gov.tw';
  }
}

function buildBase(version: string, pid: string): string {
  return `${redcapOrigin()}/redcap_v${version}/DataEntry/index.php?pid=${pid}`;
}

/** Base data-entry URL, cached for a day. Callers append `&id=…&page=…`. */
export async function getDataEntryBase(force = false): Promise<string> {
  const cached = force ? undefined : await getCachedAsync<string>(CACHE_KEY);
  if (cached) return cached;

  try {
    const [version, project] = await Promise.all([fetchRedcapVersion(), fetchProjectInfo()]);
    const pid = project.project_id || FALLBACK_PID;
    const base = buildBase(version, pid);
    setCached(CACHE_KEY, base, CACHE_TTL_SECONDS);
    return base;
  } catch {
    return buildBase(FALLBACK_VERSION, FALLBACK_PID);
  }
}

/** Deep link to one record's page of one instrument. */
export function dataEntryUrl(base: string, studyId: string, page: string): string {
  return `${base}&id=${encodeURIComponent(studyId)}&page=${encodeURIComponent(page)}`;
}
