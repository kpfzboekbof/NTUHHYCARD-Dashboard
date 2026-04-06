import useSWR from 'swr';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useEtiologyData() {
  const { data, error, isLoading, mutate } = useSWR<EtiologyResponse>(
    '/api/etiology',
    fetcher,
    { refreshInterval: 300000 }
  );

  return {
    data,
    error,
    isLoading,
    refresh: async () => {
      await fetch('/api/refresh', { method: 'POST' });
      mutate();
    },
  };
}
