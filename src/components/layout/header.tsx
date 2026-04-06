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
}

export function Header({ title, fetchedAt, onRefresh, isLoading, owners = [] }: HeaderProps) {
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
        <span className="text-xs text-zinc-400">
          更新: {new Date(fetchedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </header>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
