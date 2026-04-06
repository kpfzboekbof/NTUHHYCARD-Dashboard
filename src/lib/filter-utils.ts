import type { CompletionRow, Filters } from '@/types';

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
