import useSWR from 'swr';
import type { QcResponse } from '@/app/api/qc/route';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useQcData() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<QcResponse>(
    '/api/qc',
    fetcher,
    { refreshInterval: 300000 }
  );

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(
      fetcher('/api/qc?noCache=1'),
      { revalidate: false }
    ),
  };
}
