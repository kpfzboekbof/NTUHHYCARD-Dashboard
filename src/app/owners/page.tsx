'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LazyOwnerBarChart } from '@/components/charts/lazy-charts';
import { useCompletionData } from '@/hooks/use-completion-data';
import { useFilters } from '@/hooks/use-filters';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TargetProgress } from '@/components/dashboard/target-progress';
import { filterRows, EMPTY_ROWS } from '@/lib/filter-utils';
import { getColor } from '@/lib/pct-color';
import { FORMS } from '@/config/forms';

export default function OwnersPage() {
  const router = useRouter();
  const { data, isLoading, refresh } = useCompletionData();
  const { filters } = useFilters();
  const rows = useMemo(
    () => (data?.rows ? filterRows(data.rows, filters) : EMPTY_ROWS),
    [data?.rows, filters],
  );
  const owners = data?.byOwner?.map(o => o.owner).filter(o => o !== '未指派') ?? [];

  const ownerStats = useMemo(() => {
    const validRows = rows.filter(r => !r.excluded && r.owner !== '未指派');
    const map = new Map<string, { total: number; complete: number; unverified: number; incomplete: number; forms: Set<string>; records: Set<string>; validRecords: Set<string> }>();
    for (const r of validRows) {
      let s = map.get(r.owner);
      if (!s) {
        s = { total: 0, complete: 0, unverified: 0, incomplete: 0, forms: new Set(), records: new Set(), validRecords: new Set() };
        map.set(r.owner, s);
      }
      s.total++;
      s.forms.add(r.form);
      s.records.add(r.studyId);
      s.validRecords.add(r.studyId);
      if (r.statusCode === 2) s.complete++;
      else if (r.statusCode === 1) s.unverified++;
      else s.incomplete++;
    }
    return Array.from(map.entries()).map(([owner, s]) => ({
      owner,
      pct: s.total > 0 ? Math.round(s.complete / s.total * 1000) / 10 : 0,
      formsCount: s.forms.size,
      recordsCount: s.records.size,
      validOhcaCount: s.validRecords.size,
      complete: s.complete,
      unverified: s.unverified,
      incomplete: s.incomplete,
    }));
  }, [rows]);

  const ownerFormMatrix = useMemo(() => {
    const result: { owner: string; form: string; label: string; pct: number }[] = [];
    const grouped = new Map<string, Map<string, { total: number; complete: number }>>();
    for (const r of rows.filter(r => !r.excluded && r.owner !== '未指派')) {
      const key = r.owner;
      if (!grouped.has(key)) grouped.set(key, new Map());
      const fm = grouped.get(key)!;
      if (!fm.has(r.form)) fm.set(r.form, { total: 0, complete: 0 });
      const s = fm.get(r.form)!;
      s.total++;
      if (r.statusCode === 2) s.complete++;
    }
    for (const [owner, fm] of grouped) {
      for (const [form, s] of fm) {
        const f = FORMS.find(x => x.name === form);
        result.push({
          owner,
          form,
          label: f?.label || form,
          pct: s.total > 0 ? Math.round(s.complete / s.total * 1000) / 10 : 0,
        });
      }
    }
    return result;
  }, [rows]);

  // Index the matrix so the table body is a Map lookup per cell instead of a
  // linear scan of every (owner x form) entry — the table renders
  // owners x forms cells, so the scan was quadratic in the matrix size.
  const { sortedOwners, pctByOwnerForm } = useMemo(() => {
    const byOwner = new Map<string, Map<string, number>>();
    for (const x of ownerFormMatrix) {
      let fm = byOwner.get(x.owner);
      if (!fm) { fm = new Map(); byOwner.set(x.owner, fm); }
      fm.set(x.form, x.pct);
    }
    return {
      sortedOwners: [...byOwner.keys()].sort(),
      pctByOwnerForm: byOwner,
    };
  }, [ownerFormMatrix]);

  // When a specific owner is selected, only show their forms
  const visibleForms = useMemo(() => {
    if (filters.owner === '全部') return FORMS;
    const ownerFormNames = new Set(ownerFormMatrix.map(x => x.form));
    return FORMS.filter(f => ownerFormNames.has(f.name));
  }, [filters.owner, ownerFormMatrix]);

  return (
    <div>
      <Header title="負責人進度" fetchedAt={data?.fetchedAt} onRefresh={refresh} isLoading={isLoading} owners={owners} />
      <div className="space-y-6 p-6">
        {isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : (
          <>
            {data?.targetIds && (data.targetIds.basic || data.targetIds.exam) && (
              <TargetProgress rows={rows} targetIds={data.targetIds} hiddenForms={data.hiddenForms} ownerFilter={filters.owner} />
            )}

            {/* Owner bar chart + heatmap */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>各負責人完成率</CardTitle></CardHeader>
                <CardContent>
                  <LazyOwnerBarChart data={ownerStats} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>負責人 x 表單細項</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-auto max-h-[300px]">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-white dark:bg-zinc-950">
                        <tr>
                          <th className="text-left px-2 py-1">負責人</th>
                          {visibleForms.map(f => (
                            <th key={f.name} className="px-1 py-1 font-normal" style={{ writingMode: 'vertical-rl', maxWidth: 20 }}>
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOwners.map(owner => (
                          <tr key={owner}>
                            <td className="px-2 py-1 font-medium whitespace-nowrap">{owner}</td>
                            {visibleForms.map(f => {
                              const pct = pctByOwnerForm.get(owner)?.get(f.name) ?? 0;
                              const bg = pct >= 80 ? 'bg-green-400' : pct >= 50 ? 'bg-yellow-300' : pct > 0 ? 'bg-red-300' : 'bg-zinc-100';
                              return (
                                <td
                                  key={f.name}
                                  className="px-0.5 py-0.5 cursor-pointer"
                                  title={`${owner} / ${f.label}: ${pct}% — 點擊查看未完成清單`}
                                  onClick={() => router.push(`/incomplete?form=${f.name}`)}
                                >
                                  <div className={`h-4 w-4 rounded-sm ${bg} flex items-center justify-center text-[8px] font-bold text-white hover:ring-2 hover:ring-blue-400`}>
                                    {pct > 0 ? Math.round(pct) : ''}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Owner stats table */}
            <Card>
              <CardHeader><CardTitle>負責人統計表</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="px-3 py-2">負責人</th>
                        <th className="px-3 py-2">表單數</th>
                        <th className="px-3 py-2">有效 OHCA</th>
                        <th className="px-3 py-2">Complete</th>
                        <th className="px-3 py-2">Unverified</th>
                        <th className="px-3 py-2">Incomplete</th>
                        <th className="px-3 py-2">完成率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...ownerStats].sort((a, b) => b.pct - a.pct).map(s => (
                        <tr key={s.owner} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <td className="px-3 py-2 font-medium">{s.owner}</td>
                          <td className="px-3 py-2">{s.formsCount}</td>
                          <td className="px-3 py-2">{s.validOhcaCount.toLocaleString()}</td>
                          <td className="px-3 py-2 text-green-600">{s.complete.toLocaleString()}</td>
                          <td className="px-3 py-2 text-yellow-600">{s.unverified.toLocaleString()}</td>
                          <td className={`px-3 py-2 ${s.incomplete > 100 ? 'text-red-600 font-medium' : ''}`}>
                            {s.incomplete.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-20 rounded-full bg-zinc-200">
                                <div
                                  className="h-2 rounded-full"
                                  style={{ width: `${Math.min(s.pct, 100)}%`, backgroundColor: getColor(s.pct) }}
                                />
                              </div>
                              <span className="text-xs font-medium">{s.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
