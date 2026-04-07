import useSWR from 'swr';
import type { QcResponse } from '@/types';

const fetcher = async (url: string): Promise<QcResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
};

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
