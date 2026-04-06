import useSWR from 'swr';
import type { CompletionResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useCompletionData() {
  const { data, error, isLoading, mutate } = useSWR<CompletionResponse>(
    '/api/completion',
    fetcher,
    { refreshInterval: 300000 } // 5 min
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
