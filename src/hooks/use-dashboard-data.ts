import useSWR from 'swr';

/** Fetch JSON, throwing the response body as an Error on non-2xx status. */
export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Shared SWR wrapper for the dashboard API endpoints. Every data hook used
 * to copy the same fetcher + `isLoading || isValidating` + noCache-refresh
 * pattern — this is the single copy.
 */
export function useDashboardData<T>(url: string, refreshInterval: number) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    url,
    jsonFetcher,
    { refreshInterval },
  );

  return {
    data,
    error: error as Error | undefined,
    mutate,
    isLoading: isLoading || isValidating,
    // Bypass the server cache; keep the currently shown data if the refetch
    // fails instead of surfacing an unhandled rejection.
    refresh: () =>
      mutate(
        jsonFetcher<T>(`${url}${url.includes('?') ? '&' : '?'}noCache=1`),
        { revalidate: false },
      ).catch(() => undefined),
  };
}
