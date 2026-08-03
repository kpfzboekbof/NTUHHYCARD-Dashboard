import type { CompletionRow, Filters } from '@/types';

/**
 * Stable empty result. Call sites use this instead of a fresh `[]` so that a
 * not-yet-loaded response does not invalidate every downstream useMemo on
 * every render.
 */
export const EMPTY_ROWS: CompletionRow[] = [];

export function filterRows(rows: CompletionRow[], filters: Filters): CompletionRow[] {
  let result = rows;
  if (filters.owner !== '全部') {
    result = result.filter(r => r.owner === filters.owner);
  }
  if (filters.hospital !== '全部') {
    result = result.filter(r => r.hospitalName === filters.hospital);
  }
  return result;
}
