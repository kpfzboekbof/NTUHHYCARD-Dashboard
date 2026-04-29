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
    {
      // 5 分鐘自動刷新（scraper 一天最多跑幾次，60s 太頻繁，浪費 blob read）
      refreshInterval: 5 * 60 * 1000,
      // 視窗重新獲得焦點時刷新（讓使用者切回 tab 立刻看到最新資料）
      revalidateOnFocus: true,
    }
  );

  return {
    data,
    error,
    isLoading: isLoading || isValidating,
    refresh: () => mutate(),
  };
}
