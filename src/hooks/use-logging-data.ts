import { useEffect } from 'react';
import useSWR from 'swr';
import { useAdaptiveInterval } from './use-adaptive-interval';
import type { LoggingResponse, Filters } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function timeRangeToMonths(range: Filters['timeRange']): number {
  switch (range) {
    case 'week': return 1;
    case 'month': return 1;
    case '3months': return 3;
    case '6months': return 6;
    case 'all': return 12;
  }
}

export function useLoggingData(timeRange: Filters['timeRange'] = '3months') {
  const months = timeRangeToMonths(timeRange);
  const [refreshInterval, track] = useAdaptiveInterval(600_000);
  const { data, error, isLoading, isValidating, mutate } = useSWR<LoggingResponse>(
    `/api/logging?months=${months}`,
    fetcher,
    { refreshInterval },
  );
  useEffect(() => track(data?.refreshing), [data?.refreshing, track]);

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(
      fetcher(`/api/logging?months=${months}&noCache=1`),
      { revalidate: false },
    ),
  };
}
