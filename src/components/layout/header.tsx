'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFilters } from '@/hooks/use-filters';
import { HOSPITAL_OPTIONS } from '@/config/hospitals';

interface HeaderProps {
  title: string;
  fetchedAt?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
  owners?: string[];
  /** The data shown is past its freshness window. */
  stale?: boolean;
  /** A rebuild is running behind the scenes; the page polls for it. */
  refreshing?: boolean;
  /** Background rebuilds keep dying; only the button will move this page now. */
  refreshFailed?: boolean;
}

/**
 * What the timestamp means now: every heavy page answers from its last build
 * and refreshes behind the response, so the time shown can be older than the
 * moment of the visit. The badge says whether a newer build is on its way.
 */
function Freshness({ refreshing, stale, refreshFailed }: Pick<HeaderProps, 'refreshing' | 'stale' | 'refreshFailed'>) {
  if (refreshFailed) {
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300" title="背景重新推導連續失敗，請按「重新抓取」在前景重跑">背景更新失敗</span>;
  }
  if (refreshing) {
    return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300" title="正在向 REDCap 重新推導，完成後會自動換上新資料">背景更新中</span>;
  }
  if (stale) {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300" title="這份資料已超過更新間隔">資料較舊</span>;
  }
  return null;
}

export function Header({ title, fetchedAt, onRefresh, isLoading, owners = [], stale, refreshing, refreshFailed }: HeaderProps) {
  const { filters, setFilter } = useFilters();

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-4 border-b bg-white/80 py-3 pl-14 pr-6 backdrop-blur dark:bg-zinc-950/80">
      <h1 className="mr-auto text-xl font-bold">{title}</h1>

      <div className="flex items-center gap-2 text-sm">
        <label className="text-zinc-500">負責人:</label>
        <select
          className="rounded border px-2 py-1 text-sm"
          value={filters.owner}
          onChange={e => setFilter('owner', e.target.value)}
        >
          <option value="全部">全部</option>
          {owners.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label className="text-zinc-500">院區:</label>
        <select
          className="rounded border px-2 py-1 text-sm"
          value={filters.hospital}
          onChange={e => setFilter('hospital', e.target.value)}
        >
          {HOSPITAL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {onRefresh && (
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', isLoading && 'animate-spin')} />
          重新抓取
        </Button>
      )}

      {fetchedAt && (
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          <span>
            更新: {new Date(fetchedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          <Freshness refreshing={refreshing} stale={stale} refreshFailed={refreshFailed} />
        </span>
      )}
    </header>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
