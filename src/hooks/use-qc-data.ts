import { useDashboardData } from './use-dashboard-data';
import type { QcResponse } from '@/types';

export function useQcData() {
  return useDashboardData<QcResponse>('/api/qc', 300000);
}
