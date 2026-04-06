'use client';

import { useMemo, useState } from 'react';
import { useEtiologyData } from '@/hooks/use-etiology-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LABELERS } from '@/lib/redcap/etiology-transform';

const PAGE_SIZE = 50;

export default function EtiologyPage() {
  const { data, isLoading, refresh } = useEtiologyData();
  const [search, setSearch] = useState('');
  const [idFrom, setIdFrom] = useState('');
  const [idTo, setIdTo] = useState('');
  const [page, setPage] = useState(0);

  const incompleteRecords = useMemo(() => {
    if (!data?.records) return [];
    let result = data.records.filter(r => r.finalCode === null);
    if (search) {
      result = result.filter(r => r.studyId.includes(search));
    }
    const from = parseInt(idFrom);
    const to = parseInt(idTo);
    if (!isNaN(from)) {
      result = result.filter(r => parseInt(r.studyId) >= from);
    }
    if (!isNaN(to)) {
      result = result.filter(r => parseInt(r.studyId) <= to);
    }
    return result;
  }, [data, search, idFrom, idTo]);

  const pageRows = incompleteRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(incompleteRecords.length / PAGE_SIZE);

  const stats = data?.stats;

  return (
    <div>
      <Header title="Etiology 共識追蹤" fetchedAt={data?.fetchedAt} onRefresh={refresh} isLoading={isLoading} />
      <div className="space-y-6 p-6">
        {isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : (
          <>
            {/* Stats cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold">{stats?.total.toLocaleString()}</p>
                  <p className="text-sm text-zinc-500">總記錄數</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold text-green-600">{stats?.finalComplete.toLocaleString()}</p>
                  <p className="text-sm text-zinc-500">已完成共識 (etiology_final)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold text-amber-600">{stats?.finalIncomplete.toLocaleString()}</p>
                  <p className="text-sm text-zinc-500">尚未完成共識</p>
                </CardContent>
              </Card>
            </div>

            {/* Incomplete records table */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-4">
                  <CardTitle className="mr-auto">
                    尚未完成 etiology_final 的記錄
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      ({incompleteRecords.length.toLocaleString()} 筆)
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-zinc-500">ID 範圍:</span>
                    <input
                      type="number"
                      placeholder="從"
                      className="rounded border px-2 py-1 text-sm w-20"
                      value={idFrom}
                      onChange={e => { setIdFrom(e.target.value); setPage(0); }}
                    />
                    <span className="text-zinc-400">—</span>
                    <input
                      type="number"
                      placeholder="到"
                      className="rounded border px-2 py-1 text-sm w-20"
                      value={idTo}
                      onChange={e => { setIdTo(e.target.value); setPage(0); }}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="搜尋 Study ID..."
                    className="rounded border px-3 py-1 text-sm w-48"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0); }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="px-3 py-2 sticky left-0 bg-white dark:bg-zinc-950">Study ID</th>
                        {LABELERS.map(l => (
                          <th key={l.code} className="px-2 py-2 text-center whitespace-nowrap">{l.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(r => (
                        <tr key={r.studyId} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <td className="px-3 py-1.5 font-mono text-xs sticky left-0 bg-white dark:bg-zinc-950">{r.studyId}</td>
                          {r.reviewers.map(rev => (
                            <td key={rev.labelerCode} className="px-2 py-1.5 text-center">
                              {rev.complete ? (
                                <span className="text-green-600 font-bold">✓</span>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {pageRows.length === 0 && (
                        <tr>
                          <td colSpan={1 + LABELERS.length} className="px-3 py-8 text-center text-zinc-400">
                            {search ? '無符合的記錄' : '所有記錄皆已完成共識'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-zinc-500">
                      第 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, incompleteRecords.length)} / {incompleteRecords.length} 筆
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
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
