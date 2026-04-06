'use client';

import { useCompletionData } from '@/hooks/use-completion-data';
import { useFilters } from '@/hooks/use-filters';
import { Header } from '@/components/layout/header';
import { CompletionHeatmap } from '@/components/heatmap/completion-heatmap';
import { filterRows } from '@/lib/filter-utils';

export default function HeatmapPage() {
  const { data, isLoading, refresh } = useCompletionData();
  const { filters } = useFilters();

  const rows = data?.rows ? filterRows(data.rows, filters) : [];

  return (
    <div>
      <Header title="熱力圖" fetchedAt={data?.fetchedAt} onRefresh={refresh} isLoading={isLoading} owners={data?.byOwner?.map(o => o.owner) ?? []} />
      <div className="p-6">
        {isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center text-zinc-400">無資料（請確認 API 連線設定）</div>
        ) : (
          <CompletionHeatmap rows={rows} />
        )}
      </div>
    </div>
  );
}
