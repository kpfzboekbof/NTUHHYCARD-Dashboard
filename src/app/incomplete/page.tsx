'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { ExternalLink, Mail, Sparkles } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { WorkState } from '@/lib/state/types';

/**
 * The operator's queue browser, reading the state engine.
 *
 * This page absorbed what the design once called /me (§1.5): the same three
 * facets — whose, in which state, new since when — as URL parameters, so any
 * slice of the queue is a link. The six-state model replaces the old 0/1/2:
 * blocked shows who is being waited on instead of reading as laziness, and
 * entered_awaiting_verify makes the assistant→doctor handoff visible.
 */

interface MatrixCell {
  studyId: string;
  unitId: string;
  state: WorkState;
  blockReason?: { kind: string; field?: string; enteredByUnit?: string; unitId?: string; detail?: string };
  hospital: number;
  owner: string;
}

interface MatrixUnit {
  unitId: string;
  label: string;
  deepLinkPage: string;
  owner: string;
  ownerPersonId: string | null;
  counts: Record<WorkState, number>;
}

interface MatrixResponse {
  redcapBaseUrl: string;
  units: MatrixUnit[];
  totals: { records: number; excluded: number; screeningPending: number; fullyComplete: number };
  fetchedAt: string;
  cells: MatrixCell[];
  matched: number;
  offset: number;
  limit: number;
  error?: string;
}

const STATE_LABELS: Record<WorkState, string> = {
  ready: '可開始',
  in_progress: '進行中',
  entered_awaiting_verify: '待確認',
  blocked: '被擋住',
  complete: '完成',
  not_applicable: '不適用',
};

const STATE_STYLES: Record<WorkState, string> = {
  ready: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  entered_awaiting_verify: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  blocked: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  complete: 'bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500',
  not_applicable: 'bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600',
};

/** The default slice imitates the old page: what is workable today. */
const DEFAULT_STATES = 'ready,in_progress';
const STATE_CHOICES: Array<{ value: string; label: string }> = [
  { value: DEFAULT_STATES, label: '今日清單（可開始＋進行中）' },
  { value: 'ready', label: '可開始' },
  { value: 'in_progress', label: '進行中' },
  { value: 'entered_awaiting_verify', label: '待確認（醫師簽核）' },
  { value: 'blocked', label: '被擋住' },
  { value: 'complete', label: '完成' },
];

const PAGE_SIZE = 100;

function blockReasonText(cell: MatrixCell, unitLabels: Map<string, string>): string {
  const reason = cell.blockReason;
  if (!reason) return '';
  switch (reason.kind) {
    case 'excluded': return '已排除';
    case 'awaiting_gate':
      return `等 ${unitLabels.get(reason.enteredByUnit ?? '') ?? reason.enteredByUnit} 填 ${reason.field}`;
    case 'awaiting_unit':
      return `等 ${unitLabels.get(reason.unitId ?? '') ?? reason.unitId}`;
    case 'awaiting_consensus': return '等 etiology 共識';
    case 'awaiting_config': return `設定問題：${reason.detail ?? ''}`;
    default: return reason.kind;
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as MatrixResponse;
};

function QueueView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = searchParams.get('state') ?? DEFAULT_STATES;
  const unit = searchParams.get('unit') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const since = searchParams.get('since') ?? '';
  const page = Math.max(Number(searchParams.get('page')) || 0, 0);

  // Every facet lives in the URL, so a slice of the queue is a pasteable link.
  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }, [router, pathname, searchParams]);

  const query = new URLSearchParams({ state, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (unit) query.set('unit', unit);
  if (owner) query.set('owner', owner);
  if (since) query.set('since', since);

  const { data, error, isLoading, mutate } = useSWR<MatrixResponse>(
    `/api/state/matrix?${query.toString()}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  const [search, setSearch] = useState('');
  const [nudging, setNudging] = useState(false);
  const [nudgeResult, setNudgeResult] = useState('');

  const unitLabels = useMemo(
    () => new Map((data?.units ?? []).map(u => [u.unitId, u.label])),
    [data],
  );
  const owners = useMemo(
    () => [...new Set((data?.units ?? []).map(u => u.owner))].sort(),
    [data],
  );

  // The nudge target: the person behind the currently selected owner facet.
  const nudgeTarget = useMemo(() => {
    if (!owner || !data) return null;
    const withPerson = data.units.find(u => u.owner === owner && u.ownerPersonId);
    if (withPerson) return { personId: withPerson.ownerPersonId!, name: owner, linked: true as const };
    if (data.units.some(u => u.owner === owner)) return { personId: null, name: owner, linked: false as const };
    return null;
  }, [owner, data]);

  const sendNudge = useCallback(async () => {
    if (!nudgeTarget?.personId || nudging) return;
    setNudging(true);
    setNudgeResult('');
    try {
      const res = await fetch('/api/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: nudgeTarget.personId }),
      });
      const result = await res.json();
      if (!res.ok) setNudgeResult(`寄送失敗：${result.error}`);
      else if (result.empty) setNudgeResult(result.message);
      else setNudgeResult(`已寄給 ${result.to}（${result.units.map((u: { label: string; ready: number; awaiting: number }) => `${u.label} ${u.ready + u.awaiting} 筆`).join('、')}）`);
    } catch {
      setNudgeResult('連線失敗，請再試一次');
    } finally {
      setNudging(false);
    }
  }, [nudgeTarget, nudging]);

  const cells = useMemo(() => {
    const all = data?.cells ?? [];
    if (!search) return all;
    return all.filter(c => c.studyId.includes(search.trim()));
  }, [data, search]);

  const totalPages = data ? Math.ceil(data.matched / PAGE_SIZE) : 0;

  return (
    <>
      <Header title="未完成清單" fetchedAt={data?.fetchedAt} onRefresh={() => mutate()} isLoading={isLoading} />
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <label className="text-zinc-500">狀態：</label>
            <select className="rounded border px-2 py-1" value={state} onChange={e => setParam('state', e.target.value)}>
              {STATE_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <label className="text-zinc-500">單元：</label>
            <select className="rounded border px-2 py-1" value={unit} onChange={e => setParam('unit', e.target.value)}>
              <option value="">全部</option>
              {(data?.units ?? []).map(u => <option key={u.unitId} value={u.unitId}>{u.label}</option>)}
            </select>

            <label className="text-zinc-500">負責人：</label>
            <select className="rounded border px-2 py-1" value={owner} onChange={e => setParam('owner', e.target.value)}>
              <option value="">全部</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            <label className="flex items-center gap-1 text-zinc-500">
              <input
                type="checkbox"
                checked={since === '7d'}
                onChange={e => setParam('since', e.target.checked ? '7d' : '')}
              />
              <Sparkles className="h-3.5 w-3.5" />只看新交接（7 天內）
            </label>

            <input
              className="w-32 rounded border px-2 py-1"
              placeholder="搜尋編號"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            {nudgeTarget && (
              nudgeTarget.linked ? (
                <Button size="sm" disabled={nudging} onClick={sendNudge}>
                  <Mail className="mr-1 h-3.5 w-3.5" />
                  {nudging ? '寄送中...' : `寄提醒給 ${nudgeTarget.name}`}
                </Button>
              ) : (
                <span className="text-xs text-zinc-400">
                  {nudgeTarget.name} 尚未連結 person（到 /admin/people 匯入後才能寄提醒）
                </span>
              )
            )}
          </CardContent>
        </Card>

        {nudgeResult && <p className="text-sm text-blue-700 dark:text-blue-300">{nudgeResult}</p>}
        {error && <p className="text-sm text-red-600">讀取失敗：{String(error.message ?? error)}</p>}
        {since === '7d' && !isLoading && data?.matched === 0 && (
          <p className="text-sm text-zinc-500">
            沒有 7 天內的新交接。這個切面靠每日快照的事件累積——快照 cron 至少要成功跑過兩次才會有資料。
          </p>
        )}

        <Card>
          <CardContent className="overflow-x-auto p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-zinc-500">推導狀態矩陣中...（第一次或快取過期時約需一分鐘）</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="p-2 pl-4">編號</th>
                    <th className="p-2">單元</th>
                    <th className="p-2">狀態</th>
                    <th className="p-2">卡在哪</th>
                    <th className="p-2">負責人</th>
                    <th className="p-2">REDCap</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map(cell => {
                    const unitInfo = data?.units.find(u => u.unitId === cell.unitId);
                    const link = data && unitInfo
                      ? `${data.redcapBaseUrl}&id=${encodeURIComponent(cell.studyId)}&page=${encodeURIComponent(unitInfo.deepLinkPage)}`
                      : null;
                    return (
                      <tr key={`${cell.studyId}-${cell.unitId}`} className="border-b last:border-0">
                        <td className="p-2 pl-4 font-mono">{cell.studyId}</td>
                        <td className="p-2">{unitLabels.get(cell.unitId) ?? cell.unitId}</td>
                        <td className="p-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${STATE_STYLES[cell.state]}`}>
                            {STATE_LABELS[cell.state]}
                          </span>
                        </td>
                        <td className="p-2 text-zinc-500">{blockReasonText(cell, unitLabels)}</td>
                        <td className="p-2">{cell.owner}</td>
                        <td className="p-2">
                          {link && (
                            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                              開啟<ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {cells.length === 0 && !isLoading && (
                    <tr><td colSpan={6} className="p-6 text-center text-zinc-400">這個切面目前是空的</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {data && totalPages > 1 && (
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setParam('page', String(page - 1))}>上一頁</Button>
            <span>第 {page + 1} / {totalPages} 頁（共 {data.matched} 筆）</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setParam('page', String(page + 1))}>下一頁</Button>
          </div>
        )}
      </div>
    </>
  );
}

export default function IncompletePage() {
  return (
    <Suspense fallback={<div className="p-6 text-zinc-400">載入中...</div>}>
      <QueueView />
    </Suspense>
  );
}
