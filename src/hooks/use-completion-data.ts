import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { unpackCompletion } from '@/lib/redcap/completion-codec';
import { useAdaptiveInterval } from './use-adaptive-interval';
import type { CompletionPayload, CompletionResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

/**
 * The completion matrix, unpacked.
 *
 * The API sends `packed` — one tuple per record with a status character per
 * form — instead of ~190,000 row objects; the rows every component consumes
 * are rebuilt here, once per response.
 */
export function useCompletionData() {
  const [refreshInterval, track] = useAdaptiveInterval(300_000);
  const { data: payload, error, isLoading, isValidating, mutate } = useSWR<CompletionPayload>(
    '/api/completion',
    fetcher,
    { refreshInterval },
  );
  useEffect(() => track(payload?.refreshing), [payload?.refreshing, track]);

  const data = useMemo<CompletionResponse | undefined>(() => {
    if (!payload) return undefined;
    // An error body has no `packed`; keep the shape so pages can tell.
    if (!payload.packed) return { ...payload, rows: undefined as unknown as CompletionResponse['rows'] };
    const { packed, ...rest } = payload;
    return { ...rest, rows: unpackCompletion(packed) };
  }, [payload]);

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(
      fetcher('/api/completion?noCache=1'),
      { revalidate: false },
    ),
  };
}
