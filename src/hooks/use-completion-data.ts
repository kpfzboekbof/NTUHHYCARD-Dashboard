import { useDashboardData } from './use-dashboard-data';
import type { CompletionResponse } from '@/types';

export function useCompletionData() {
  return useDashboardData<CompletionResponse>('/api/completion', 300000); // 5 min
}
