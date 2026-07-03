import { useCallback } from 'react';
import useSWR from 'swr';
import { ETIOLOGY_FINAL_MAP } from '@/lib/redcap/etiology-transform';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useEtiologyData() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<EtiologyResponse>(
    '/api/etiology',
    fetcher,
    { refreshInterval: 300000 }
  );

  /**
   * Mark records as having etiology_final set, in the local SWR cache only.
   * Called after the server confirms a REDCap write, so local state already
   * matches the server — no refetch needed. This makes saved rows leave the
   * 「尚未完成」 list instantly instead of after a multi-second full REDCap
   * re-export, which during a consensus meeting made it hard to tell which
   * record was just handled.
   */
  const applyFinalLocally = useCallback(
    (updates: Array<{ studyId: string; code: number }>) =>
      mutate(current => {
        if (!current) return current;
        const byId = new Map(updates.map(u => [u.studyId, u.code]));
        const records = current.records.map(r => {
          const code = byId.get(r.studyId);
          if (code === undefined) return r;
          return {
            ...r,
            finalCode: code,
            finalLabel: ETIOLOGY_FINAL_MAP[code] ?? `Code ${code}`,
          };
        });
        return {
          ...current,
          records,
          stats: {
            ...current.stats,
            finalComplete: records.filter(r => r.finalCode !== null).length,
            finalIncomplete: records.filter(r => r.finalCode === null).length,
          },
        };
      }, { revalidate: false }),
    [mutate],
  );

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    applyFinalLocally,
    refresh: () => mutate(
      fetcher('/api/etiology?noCache=1'),
      { revalidate: false }
    ),
  };
}
