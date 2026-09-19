/**
 * Which scraper files the watchdog expects today, and which are missing.
 *
 * Pure: the route lists Blob and hands the pathnames in, so this can be
 * tested without a store. File names follow the upload contract:
 * `screening/2026-09/2026-09-15__hsinchu.json`, or the legacy `2026-09-15.json`
 * from before sites existed.
 */

export type ScraperExpectation = 'auto' | 'paused' | Set<string>;

/**
 * Reads SCRAPER_SITES.
 *
 *   unset / blank   → 'auto': whichever sites have uploaded this month are
 *                     expected every weekday. Self-adapting, and therefore
 *                     blind to a scraper that stopped before the month began.
 *   "none"          → 'paused': the scrapers are deliberately off; check nothing.
 *   "main,yunlin"   → exactly these sites, whether or not any has uploaded yet.
 */
export function scraperExpectation(raw: string | undefined): ScraperExpectation {
  const value = (raw ?? '').trim();
  if (value === '') return 'auto';
  if (value.toLowerCase() === 'none') return 'paused';
  return new Set(value.split(',').map(s => s.trim()).filter(Boolean));
}

export interface ScreeningFile {
  date: string;
  site: string;
}

/** A daily scan file's date and site; the review ledger and non-JSON are not scans. */
export function parseScreeningPathname(pathname: string): ScreeningFile | null {
  const base = pathname.split('/').pop() ?? '';
  if (!base.endsWith('.json') || base.endsWith('_reviews.json')) return null;
  const name = base.slice(0, -5);
  const sep = name.indexOf('__');
  return sep > 0
    ? { date: name.slice(0, sep), site: name.slice(sep + 2) }
    : { date: name, site: '(單一檔)' };
}

export interface ScanCheck {
  /** Expected today and not uploaded, sorted. Empty means a good day. */
  missing: string[];
  /** Everything that did upload today, expected or not, sorted. */
  uploaded: string[];
}

/**
 * null means there is nothing to say: the check is paused, or it is in auto
 * mode with no upload this month to compare against.
 */
export function checkScraperFiles(
  pathnames: string[],
  today: string,
  expected: ScraperExpectation,
): ScanCheck | null {
  if (expected === 'paused') return null;

  const seen = new Set<string>();
  const todaySites = new Set<string>();
  for (const pathname of pathnames) {
    const file = parseScreeningPathname(pathname);
    if (!file) continue;
    seen.add(file.site);
    if (file.date === today) todaySites.add(file.site);
  }

  const wanted = expected === 'auto' ? seen : expected;
  if (wanted.size === 0) return null;

  return {
    missing: [...wanted].filter(site => !todaySites.has(site)).sort(),
    uploaded: [...todaySites].sort(),
  };
}
