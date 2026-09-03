import { useEffect } from 'react';
import useSWR from 'swr';
import { useAdaptiveInterval } from './use-adaptive-interval';
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
  const [refreshInterval, track] = useAdaptiveInterval(300_000);
  const { data, error, isLoading, isValidating, mutate } = useSWR<QcResponse>(
    '/api/qc',
    fetcher,
    { refreshInterval },
  );
  useEffect(() => track(data?.refreshing), [data?.refreshing, track]);

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(
      fetcher('/api/qc?noCache=1'),
      { revalidate: false },
    ),
  };
}
