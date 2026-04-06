'use client';

import { useCompletionData } from '@/hooks/use-completion-data';
import { useFilters } from '@/hooks/use-filters';
import { Header } from '@/components/layout/header';
import { StatCards } from '@/components/dashboard/stat-cards';
import { FormBarChart } from '@/components/dashboard/form-bar-chart';
import { TargetProgress } from '@/components/dashboard/target-progress';
import { filterRows } from '@/lib/filter-utils';

export default function DashboardPage() {
  const { data, isLoading, refresh } = useCompletionData();
  const { filters } = useFilters();

  const rows = data?.rows ? filterRows(data.rows, filters) : [];
  const byForm = data?.byForm
    ? data.byForm.filter(f =>
        (filters.owner === '全部' || f.owner === filters.owner)
      )
    : [];
  const owners = data?.byOwner?.map(o => o.owner) ?? [];
  const hasError = data && !data.rows;

  return (
    <div>
      <Header
        title="總覽"
        fetchedAt={data?.fetchedAt}
        onRefresh={refresh}
        isLoading={isLoading}
        owners={owners}
      />
      <div className="space-y-6 p-6">
        {hasError ? (
          <div className="py-20 text-center text-red-400">
            API 連線失敗。請確認 .env.local 中的 REDCAP_TOKEN 已正確設定。
          </div>
        ) : isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : (
          <>
            <StatCards rows={rows} />
            {data?.targetIds && (data.targetIds.basic || data.targetIds.exam) && (
              <TargetProgress rows={rows} targetIds={data.targetIds} hiddenForms={data.hiddenForms} />
            )}
            <FormBarChart data={byForm} />
          </>
        )}
      </div>
    </div>
  );
}
