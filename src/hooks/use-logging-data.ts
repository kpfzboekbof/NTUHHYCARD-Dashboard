import { useDashboardData } from './use-dashboard-data';
import type { LoggingResponse, Filters } from '@/types';

// NOTE: the logging API only supports month granularity, so「本週」and
// 「本月」both map to 1 month of data.
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
  return useDashboardData<LoggingResponse>(`/api/logging?months=${months}`, 600000);
}
