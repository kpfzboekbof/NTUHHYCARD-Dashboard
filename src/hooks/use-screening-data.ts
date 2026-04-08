import useSWR from 'swr';
import type { ScreeningResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(r.status === 401 ? '未授權' : '載入失敗');
  return r.json();
});

export function useScreeningData(month: string) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ScreeningResponse>(
    `/api/screening?month=${month}`,
    fetcher,
    { refreshInterval: 60000 } // 1 min auto-refresh
  );

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(),
  };
}
