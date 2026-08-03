import useSWR from 'swr';
import type { CompletionResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useCompletionData() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<CompletionResponse>(
    '/api/completion',
    fetcher,
    {
      refreshInterval: 300000, // 5 min
      // Six pages share this key, and SWR revalidates on every mount — so each
      // sidebar navigation re-downloaded and re-parsed the whole completion
      // payload. The server TTL is 300 s, so those refetches were almost always
      // returning a byte-identical body. Deduping for 60 s bounds the extra
      // staleness well inside that window.
      //
      // Scoped to this hook deliberately: in the shared SWRConfig it would also
      // throttle the intentional focus-refresh in use-screening-data. Mutation-
      // and refresh()-triggered revalidation bypass deduping, so the /assign
      // save path still updates immediately.
      dedupingInterval: 60000,
    }
  );

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(
      fetcher('/api/completion?noCache=1'),
      { revalidate: false }
    ),
  };
}
