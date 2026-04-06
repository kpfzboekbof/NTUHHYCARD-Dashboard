'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useCompletionData } from '@/hooks/use-completion-data';
import { useLoggingData } from '@/hooks/use-logging-data';
import { useFilters } from '@/hooks/use-filters';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FORMS } from '@/config/forms';
import type { Filters, OwnerProductivity } from '@/types';

const TIME_OPTIONS: { value: Filters['timeRange']; label: string }[] = [
  { value: 'week',    label: '本週' },
  { value: 'month',   label: '本月' },
  { value: '3months', label: '近 3 個月' },
  { value: '6months', label: '近 6 個月' },
  { value: 'all',     label: '全部' },
];

function gradeColor(grade: string) {
  switch (grade) {
    case '優': return 'bg-green-100 text-green-700';
    case '良': return 'bg-blue-100 text-blue-700';
    case '待加強': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-red-100 text-red-700';
  }
}

function daysColor(days: number | null) {
  if (days === null) return '';
  if (days <= 14) return 'text-green-600';
  if (days <= 30) return 'text-yellow-600';
  return 'text-red-600 font-medium';
}

export default function ProductivityPage() {
  const { filters, setFilter } = useFilters();
  const { data: compData } = useCompletionData();
  const { data: logData, isLoading } = useLoggingData(filters.timeRange);
  const ownerFilter = filters.owner;
  const [selectedUser, setSelectedUser] = useState(ownerFilter);

  // Sync timeline user selection when header owner filter changes
  useEffect(() => {
    setSelectedUser(ownerFilter);
  }, [ownerFilter]);
  const byOwner = (logData?.byOwner || []).filter(o => ownerFilter === '全部' || o.owner === ownerFilter);
  const byOwnerForm = (logData?.byOwnerForm || []).filter(o => ownerFilter === '全部' || o.owner === ownerFilter);
  const timeline = logData?.timeline || [];

  // Summary stats
  const totalEntries = byOwner.reduce((s, o) => s + o.entriesPeriod, 0);
  const activeCount = byOwner.filter(o => o.daysSince !== null && o.daysSince <= 30).length;
  const avgDays = byOwner.filter(o => o.daysSince !== null).length > 0
    ? Math.round(byOwner.filter(o => o.daysSince !== null).reduce((s, o) => s + (o.daysSince || 0), 0)
      / byOwner.filter(o => o.daysSince !== null).length)
    : null;
  const overallPct = byOwner.length > 0
    ? Math.round(byOwner.reduce((s, o) => s + o.totalComplete, 0)
      / Math.max(byOwner.reduce((s, o) => s + o.totalTarget, 0), 1) * 1000) / 10
    : 0;

  // Timeline data for chart
  const timelineData = useMemo(() => {
    let filtered = timeline;
    if (selectedUser !== '全部') {
      filtered = timeline.filter(t => t.username === selectedUser);
    }
    const weekMap = new Map<string, number>();
    for (const t of filtered) {
      weekMap.set(t.week, (weekMap.get(t.week) || 0) + t.entries);
    }
    return Array.from(weekMap.entries())
      .map(([week, entries]) => ({ week, entries }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [timeline, selectedUser]);

  const allUsers = ['全部', ...new Set(timeline.map(t => t.username))].sort();

  return (
    <div>
      <Header
        title="鍵入進度"
        fetchedAt={logData?.fetchedAt}
        isLoading={isLoading}
        owners={compData?.byOwner?.map(o => o.owner) ?? []}
      />
      <div className="space-y-6 p-6">
        {/* Time range selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">時間範圍:</span>
          <div className="flex rounded-lg border bg-white dark:bg-zinc-900 p-0.5">
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter('timeRange', opt.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filters.timeRange === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-2xl font-bold text-blue-600">{totalEntries.toLocaleString()}</p>
              <p className="text-sm text-zinc-500">鍵入次數</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-2xl font-bold text-green-600">{activeCount}</p>
              <p className="text-sm text-zinc-500">近 30 天活躍人數</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-2xl font-bold text-yellow-600">{avgDays !== null ? `${avgDays} 天` : '—'}</p>
              <p className="text-sm text-zinc-500">平均距上次登錄</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-2xl font-bold text-purple-600">{overallPct}%</p>
              <p className="text-sm text-zinc-500">整體完成度</p>
            </CardContent>
          </Card>
        </div>

        {/* Productivity table */}
        <Card>
          <CardHeader>
            <CardTitle>各負責人鍵入摘要</CardTitle>
            <p className="text-xs text-zinc-500">
              完成度 = 負責 forms 的 Complete 記錄數 / 目標筆數；「距今」超過 14 天標黃、超過 30 天標紅
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="px-3 py-2">負責人</th>
                    <th className="px-3 py-2">負責表單數</th>
                    <th className="px-3 py-2">目標總筆數</th>
                    <th className="px-3 py-2">已完成筆數</th>
                    <th className="px-3 py-2">完成度</th>
                    <th className="px-3 py-2">鍵入次數</th>
                    <th className="px-3 py-2">上次登錄</th>
                    <th className="px-3 py-2">距今(天)</th>
                    <th className="px-3 py-2">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {byOwner.sort((a, b) => a.pctComplete - b.pctComplete).map(o => (
                    <tr key={o.owner} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <td className="px-3 py-2 font-medium">{o.owner}</td>
                      <td className="px-3 py-2">{o.formsCount}</td>
                      <td className="px-3 py-2">{o.totalTarget.toLocaleString()}</td>
                      <td className="px-3 py-2">{o.totalComplete.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 rounded-full bg-zinc-200">
                            <div
                              className="h-2 rounded-full bg-blue-500"
                              style={{ width: `${Math.min(o.pctComplete, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs">{o.pctComplete}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{o.entriesPeriod.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs">
                        {o.lastEntry ? new Date(o.lastEntry).toLocaleDateString('zh-TW') : '—'}
                      </td>
                      <td className={`px-3 py-2 ${daysColor(o.daysSince)}`}>
                        {o.daysSince !== null ? o.daysSince : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${gradeColor(o.grade)}`}>
                          {o.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Bottom row: heatmap + timeline */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>負責人 x Form 完成進度</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[400px]">
                <table className="text-xs border-collapse">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-950">
                    <tr>
                      <th className="px-2 py-1 text-left">負責人</th>
                      {FORMS.map(f => (
                        <th key={f.name} className="px-1 py-1" style={{ writingMode: 'vertical-rl', maxWidth: 20 }}>
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(byOwnerForm.map(x => x.owner))].sort().map(owner => (
                      <tr key={owner}>
                        <td className="px-2 py-1 font-medium whitespace-nowrap">{owner}</td>
                        {FORMS.map(f => {
                          const item = byOwnerForm.find(x => x.owner === owner && x.form === f.name);
                          const pct = item?.pct ?? 0;
                          const bg = pct >= 90 ? 'bg-green-400' : pct >= 50 ? 'bg-yellow-300' : pct > 0 ? 'bg-red-300' : 'bg-zinc-100';
                          return (
                            <td key={f.name} className="px-0.5 py-0.5"
                              title={`${owner} / ${f.label}: ${item?.completed || 0}/${item?.target || 0} (${pct}%)`}>
                              <div className={`h-4 w-4 rounded-sm ${bg} flex items-center justify-center text-[8px] font-bold text-white`}>
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

          <Card>
            <CardHeader>
              <CardTitle>期間登錄數量趨勢</CardTitle>
              <select
                className="rounded border px-2 py-1 text-sm"
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
              >
                {allUsers.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={v => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={v => {
                      const d = new Date(v as string);
                      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 週`;
                    }}
                    formatter={(v) => [v, '鍵入次數']}
                  />
                  <Line
                    type="monotone"
                    dataKey="entries"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
