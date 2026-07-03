'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FORMS, getFormCategory } from '@/config/forms';
import { useCompletionData } from '@/hooks/use-completion-data';
import { useFilters } from '@/hooks/use-filters';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { filterRows } from '@/lib/filter-utils';
import { redcapRecordUrl } from '@/config/redcap';
import { ExternalLink } from 'lucide-react';

/** Map virtual form names to real REDCap form page names */
function toRedcapFormName(form: string): string {
  if (form === 'ntuh_nhi_core_assistant' || form === 'ntuh_nhi_core_doctor') return 'ntuh_nhi_core';
  if (form.startsWith('ntuh_nhi_outcome_')) return 'ntuh_nhi_outcome';
  return form;
}

export default function IncompletePage() {
  const searchParams = useSearchParams();
  const initialForm = searchParams.get('form') ?? 'all';
  const { data, isLoading, refresh } = useCompletionData();
  const { filters } = useFilters();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Incomplete' | 'Unverified'>('all');
  const [formFilter, setFormFilter] = useState(initialForm);
  const [targetOnly, setTargetOnly] = useState(false);
  const [lastVisited, setLastVisited] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const rows = data?.rows ? filterRows(data.rows, filters) : [];
  const hiddenForms = data?.hiddenForms ?? [];
  const visibleForms = FORMS.filter(f => !hiddenForms.includes(f.name));

  const targetIds = data?.targetIds;
  const hasTarget = !!(targetIds && (targetIds.basic || targetIds.exam));

  const incompleteRows = useMemo(() => {
    let result = rows.filter(r => r.statusCode !== 2 && !r.excluded);
    if (targetOnly && targetIds) {
      // Each form category has its own target ID (basic vs exam) — using a
      // single max threshold used to over-include the category with the
      // smaller target.
      result = result.filter(r => {
        const limit = getFormCategory(r.form) === 'exam' ? targetIds.exam : targetIds.basic;
        return !limit || parseInt(r.studyId) <= limit;
      });
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter);
    }
    if (formFilter !== 'all') {
      result = result.filter(r => r.form === formFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.studyId.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q) ||
        r.hospitalName.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) =>
      a.owner.localeCompare(b.owner) ||
      a.form.localeCompare(b.form) ||
      parseInt(a.studyId) - parseInt(b.studyId)
    );
  }, [rows, statusFilter, formFilter, search, targetOnly, targetIds]);

  const pageRows = incompleteRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(incompleteRows.length / PAGE_SIZE);

  return (
    <div>
      <Header title="未完成清單" fetchedAt={data?.fetchedAt} onRefresh={refresh} isLoading={isLoading} owners={data?.byOwner?.map(o => o.owner) ?? []} />
      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <CardTitle className="mr-auto">
                未完成 / 未驗證 記錄清單
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  ({incompleteRows.length.toLocaleString()} 筆)
                </span>
              </CardTitle>
              <select
                className="rounded border px-2 py-1 text-sm"
                value={formFilter}
                onChange={e => { setFormFilter(e.target.value); setPage(0); }}
              >
                <option value="all">全部表單</option>
                {visibleForms.map(f => (
                  <option key={f.name} value={f.name}>{f.label}</option>
                ))}
              </select>
              <select
                className="rounded border px-2 py-1 text-sm"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0); }}
              >
                <option value="all">全部狀態</option>
                <option value="Incomplete">Incomplete</option>
                <option value="Unverified">Unverified</option>
              </select>
              {hasTarget && (
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targetOnly}
                    onChange={e => { setTargetOnly(e.target.checked); setPage(0); }}
                    className="rounded"
                  />
                  <span>目標進度</span>
                  <span className="text-xs text-zinc-400">
                    ({[
                      targetIds?.basic ? `基本 ≤ ${targetIds.basic}` : null,
                      targetIds?.exam ? `檢查 ≤ ${targetIds.exam}` : null,
                    ].filter(Boolean).join('、')})
                  </span>
                </label>
              )}
              <input
                type="text"
                placeholder="搜尋 Study ID..."
                className="rounded border px-3 py-1 text-sm w-40"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <div className="py-10 text-center text-zinc-400">載入中...</div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="px-3 py-2">Study ID</th>
                        <th className="px-3 py-2">院區</th>
                        <th className="px-3 py-2">表單</th>
                        <th className="px-3 py-2">負責人</th>
                        <th className="px-3 py-2">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r, i) => {
                        const rowKey = `${r.studyId}-${r.form}`;
                        const isVisited = lastVisited === rowKey;
                        return (
                        <tr
                          key={`${rowKey}-${i}`}
                          className={`border-b cursor-pointer transition-colors ${
                            isVisited
                              ? 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60'
                              : 'hover:bg-blue-50 dark:hover:bg-blue-950'
                          }`}
                          onClick={() => {
                            setLastVisited(rowKey);
                            window.open(redcapRecordUrl(r.studyId, toRedcapFormName(r.form)), '_blank');
                          }}
                        >
                          <td className="px-3 py-1.5 font-mono text-xs text-blue-600 flex items-center gap-1">
                            {r.studyId}
                            <ExternalLink className="h-3 w-3 text-zinc-400" />
                          </td>
                          <td className="px-3 py-1.5">{r.hospitalName}</td>
                          <td className="px-3 py-1.5">{r.label}</td>
                          <td className="px-3 py-1.5">{r.owner}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                              r.status === 'Incomplete'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {r.status}
                            </span>
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
                      第 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, incompleteRows.length)} / {incompleteRows.length} 筆
                    </span>
                    <div className="flex gap-2">
                      <button
                        className="rounded border px-3 py-1 disabled:opacity-40"
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                      >
                        上一頁
                      </button>
                      <button
                        className="rounded border px-3 py-1 disabled:opacity-40"
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
      </div>
    </div>
  );
}
