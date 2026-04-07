'use client';

import { useMemo, useState } from 'react';
import { useQcData } from '@/hooks/use-qc-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink, AlertTriangle, AlertCircle, Clock, TrendingDown, Activity, Copy } from 'lucide-react';
import { QC_CHECK_META, BEHAVIOR_CHECK_META } from '@/config/qc-checks';
import { HOSPITALS } from '@/config/hospitals';

const REDCAP_BASE = 'https://redcap.ntuh.gov.tw';
const REDCAP_PID = '8207';

function redcapRecordUrl(studyId: string, page: string): string {
  return `${REDCAP_BASE}/redcap_v16.1.9/DataEntry/index.php?pid=${REDCAP_PID}&id=${studyId}&page=${page}`;
}

const ALL_CHECK_META = [...QC_CHECK_META, ...BEHAVIOR_CHECK_META];

const CATEGORY_CONFIG = {
  consistency: { label: '重複欄位衝突', icon: Copy,          color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30',  border: 'border-purple-200 dark:border-purple-900' },
  logic:       { label: '邏輯衝突',     icon: AlertCircle,   color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-950/30',       border: 'border-red-200 dark:border-red-900' },
  chronology:  { label: '時序異常',     icon: Clock,         color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30',  border: 'border-orange-200 dark:border-orange-900' },
  outlier:     { label: '異常值偵測',   icon: TrendingDown,  color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-950/30',   border: 'border-amber-200 dark:border-amber-900' },
  behavior:    { label: '登錄行為品管', icon: Activity,      color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-950/30',     border: 'border-blue-200 dark:border-blue-900' },
} as const;

const PAGE_SIZE = 50;

export default function QcPage() {
  const { data, error, isLoading, refresh } = useQcData();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeCheck, setActiveCheck] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [lastVisited, setLastVisited] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Merge all flags into unified list
  const allFlags = useMemo(() => {
    if (!data || !data.recordFlags) return [];

    const recordItems = data.recordFlags.map(f => ({
      key: `${f.studyId}-${f.checkId}-${f.redcapPage}`,
      studyId: f.studyId,
      hospital: HOSPITALS[parseInt(f.hospital)] || `院區${f.hospital}`,
      checkId: f.checkId,
      category: f.category,
      severity: f.severity,
      message: f.message,
      redcapPage: f.redcapPage,
      owner: null as string | null,
    }));

    const behaviorItems = (data.behaviorFlags || []).map((f, i) => ({
      key: `behavior-${f.checkId}-${f.owner}-${i}`,
      studyId: null as string | null,
      hospital: null as string | null,
      checkId: f.checkId,
      category: f.category as string,
      severity: f.severity,
      message: f.message,
      redcapPage: null as string | null,
      owner: f.owner,
    }));

    return [...recordItems, ...behaviorItems];
  }, [data]);

  // Category counts for summary cards
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { consistency: 0, logic: 0, chronology: 0, outlier: 0, behavior: 0 };
    for (const f of allFlags) {
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    return counts;
  }, [allFlags]);

  // Check counts
  const checkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of allFlags) {
      counts[f.checkId] = (counts[f.checkId] || 0) + 1;
    }
    return counts;
  }, [allFlags]);

  // Filtered flags
  const filteredFlags = useMemo(() => {
    let result = allFlags;
    if (activeCategory !== 'all') {
      result = result.filter(f => f.category === activeCategory);
    }
    if (activeCheck !== 'all') {
      result = result.filter(f => f.checkId === activeCheck);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        (f.studyId && f.studyId.toLowerCase().includes(q)) ||
        f.message.toLowerCase().includes(q) ||
        (f.owner && f.owner.toLowerCase().includes(q)) ||
        f.checkId.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allFlags, activeCategory, activeCheck, search]);

  const pageRows = filteredFlags.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredFlags.length / PAGE_SIZE);

  // Available checks for the dropdown (filtered by active category)
  const availableChecks = useMemo(() => {
    if (activeCategory === 'all') return ALL_CHECK_META;
    return ALL_CHECK_META.filter(c => c.category === activeCategory);
  }, [activeCategory]);

  return (
    <div>
      <Header title="品質管制" fetchedAt={data?.fetchedAt} onRefresh={refresh} isLoading={isLoading} />

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <strong>載入失敗：</strong> {error.message || '未知錯誤'}
          </div>
        )}
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.entries(CATEGORY_CONFIG) as [keyof typeof CATEGORY_CONFIG, typeof CATEGORY_CONFIG[keyof typeof CATEGORY_CONFIG]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const count = categoryCounts[key] || 0;
            const isActive = activeCategory === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setActiveCategory(isActive ? 'all' : key);
                  setActiveCheck('all');
                  setPage(0);
                }}
                className={`rounded-lg border p-4 text-left transition-all ${
                  isActive ? `${cfg.border} ${cfg.bg} ring-2 ring-offset-1 ring-current` : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${cfg.color}`} />
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{cfg.label}</span>
                </div>
                <div className={`mt-2 text-2xl font-bold ${count > 0 ? cfg.color : 'text-zinc-300 dark:text-zinc-600'}`}>
                  {isLoading && !data ? '-' : count}
                </div>
              </button>
            );
          })}
        </div>

        {/* Flags Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <CardTitle className="mr-auto">
                異常記錄
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  ({filteredFlags.length.toLocaleString()} 筆)
                </span>
              </CardTitle>

              <select
                className="rounded border px-2 py-1 text-sm"
                value={activeCheck}
                onChange={e => { setActiveCheck(e.target.value); setPage(0); }}
              >
                <option value="all">全部指標</option>
                {availableChecks.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.id}: {c.label} ({checkCounts[c.id] || 0})
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="搜尋 Study ID / 訊息..."
                className="rounded border px-3 py-1 text-sm w-48"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </CardHeader>

          <CardContent>
            {isLoading && !data ? (
              <div className="py-10 text-center text-zinc-400">載入中...</div>
            ) : filteredFlags.length === 0 ? (
              <div className="py-10 text-center text-zinc-400">
                {allFlags.length === 0 ? '目前無異常記錄' : '無符合篩選條件的記錄'}
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="px-3 py-2 w-16">指標</th>
                        <th className="px-3 py-2 w-20">嚴重度</th>
                        <th className="px-3 py-2 w-24">Study ID</th>
                        <th className="px-3 py-2 w-16">院區</th>
                        <th className="px-3 py-2">問題描述</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((f) => {
                        const isVisited = lastVisited === f.key;
                        const meta = ALL_CHECK_META.find(m => m.id === f.checkId);
                        const catCfg = CATEGORY_CONFIG[f.category as keyof typeof CATEGORY_CONFIG];
                        const hasLink = f.studyId && f.redcapPage;

                        return (
                          <tr
                            key={f.key}
                            className={`border-b transition-colors ${
                              hasLink ? 'cursor-pointer' : ''
                            } ${
                              isVisited
                                ? 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60'
                                : hasLink
                                  ? 'hover:bg-blue-50 dark:hover:bg-blue-950'
                                  : ''
                            }`}
                            onClick={() => {
                              if (hasLink) {
                                setLastVisited(f.key);
                                window.open(redcapRecordUrl(f.studyId!, f.redcapPage!), '_blank');
                              }
                            }}
                          >
                            <td className="px-3 py-1.5">
                              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${catCfg?.color || ''}`}>
                                {f.checkId}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              {f.severity === 'error' ? (
                                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                                  <AlertCircle className="h-3 w-3" />
                                  嚴重
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                                  <AlertTriangle className="h-3 w-3" />
                                  警告
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-xs">
                              {f.studyId ? (
                                <span className="flex items-center gap-1 text-blue-600">
                                  {f.studyId}
                                  {hasLink && <ExternalLink className="h-3 w-3 text-zinc-400" />}
                                </span>
                              ) : (
                                <span className="text-zinc-400">{f.owner}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-xs">{f.hospital || '-'}</td>
                            <td className="px-3 py-1.5">
                              <div className="text-xs text-zinc-700 dark:text-zinc-300">{f.message}</div>
                              <div className="text-[11px] text-zinc-400">{meta?.description}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-zinc-500">
                      第 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filteredFlags.length)} / {filteredFlags.length} 筆
                    </span>
                    <div className="flex gap-2">
                      <button
                        className="rounded border px-3 py-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:active:bg-transparent dark:hover:bg-zinc-800 dark:active:bg-zinc-700 dark:disabled:hover:bg-transparent dark:disabled:active:bg-transparent"
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                      >
                        上一頁
                      </button>
                      <button
                        className="rounded border px-3 py-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:active:bg-transparent dark:hover:bg-zinc-800 dark:active:bg-zinc-700 dark:disabled:hover:bg-transparent dark:disabled:active:bg-transparent"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(p => p + 1)}
                      >
                        下一頁
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Legend / Check Reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">指標說明</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {(Object.entries(CATEGORY_CONFIG) as [keyof typeof CATEGORY_CONFIG, typeof CATEGORY_CONFIG[keyof typeof CATEGORY_CONFIG]][]).map(([catKey, cfg]) => {
                const Icon = cfg.icon;
                const checks = ALL_CHECK_META.filter(c => c.category === catKey);
                return (
                  <div key={catKey}>
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-4 w-4 ${cfg.color}`} />
                      <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <div className="space-y-1 pl-6">
                      {checks.map(c => (
                        <div key={c.id} className="text-xs">
                          <span className="font-mono font-semibold">{c.id}</span>
                          <span className="mx-1 text-zinc-400">|</span>
                          <span className="font-medium">{c.label}</span>
                          <span className="mx-1 text-zinc-400">-</span>
                          <span className="text-zinc-500">{c.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
