'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { AlertTriangle, ChevronDown, ChevronRight, Mail, MailCheck, UserX } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { AdminGate } from '@/components/admin-gate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { OwnersProgressResponse, OwnerRow } from '@/app/api/owners/progress/route';

/**
 * 負責人進度 — §9.1, rebuilt on the state engine.
 *
 * The numbers this replaces were wrong in a way that always pointed the same
 * direction. Completed cells were divided by a flat batch target, so whoever
 * owned a form that only applies to ICU patients was measured against every
 * patient in the registry and could not score above about 37% however
 * complete their work was; work they were blocked from starting counted
 * against them; and 落後 was decided by that same percentage, so somebody
 * handed a new form last week looked identical to somebody who had stopped.
 *
 * Every column here is either a fact about their own applicable cells or an
 * explicit statement that we do not know.
 */

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as OwnersProgressResponse;
};

const GRADE_STYLES: Record<string, string> = {
  優: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  良: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  待加強: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  落後: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  無可動工項目: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const NAME_SOURCE_NOTE: Record<string, string> = {
  directory: 'REDCap 有這個帳號，但人員名單裡還沒有他 — 沒有信箱可寄',
  unknown: 'REDCap 沒有這個帳號 — 這筆指派已經失效，請到 /assign 修正',
};

function taipeiDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' });
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function Bar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-zinc-400">無</span>;
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums">{pct}%</span>
    </div>
  );
}

function CreditNote({ row }: { row: OwnerRow }) {
  const credit = row.credit;
  if (!credit || credit.completed === 0) return <p className="text-xs text-zinc-400">沒有已完成的項目可以歸屬。</p>;

  const parts: string[] = [];
  if (credit.selfSaved) parts.push(`${credit.selfSaved} 筆由本人存檔`);
  for (const other of credit.otherSavers) parts.push(`${other.count} 筆由 ${other.username} 存檔`);
  if (credit.unattributed) parts.push(`${credit.unattributed} 筆不在日誌範圍內`);
  if (credit.sharedForm) parts.push(`${credit.sharedForm} 筆同表多單元、無法區分`);

  return (
    <p className="text-xs text-zinc-500">
      已完成 {credit.completed} 筆：{parts.join('、')}。
      {credit.otherSaved > 0 && (
        <span className="ml-1 text-amber-600">實際存檔的人和指派的人不同。</span>
      )}
    </p>
  );
}

function OwnerDetail({ row }: { row: OwnerRow }) {
  return (
    <td colSpan={8} className="bg-zinc-50 px-6 py-4 dark:bg-zinc-900">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold text-zinc-500">逐單元</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="pb-1">單元</th>
                <th className="pb-1 text-right">完成/適用</th>
                <th className="pb-1 text-right">可開始</th>
                <th className="pb-1 text-right">待確認</th>
                <th className="pb-1 text-right">被擋住</th>
                <th className="pb-1 text-right">不適用</th>
              </tr>
            </thead>
            <tbody>
              {row.units.map(unit => (
                <tr key={unit.unitId} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-1">
                    <Link className="hover:underline" href={`/incomplete?unit=${unit.unitId}`}>{unit.label}</Link>
                  </td>
                  <td className="py-1 text-right tabular-nums">{unit.done}/{unit.workable}</td>
                  <td className="py-1 text-right tabular-nums">{unit.ready}</td>
                  <td className="py-1 text-right tabular-nums">{unit.awaitingVerify}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-400">{unit.blocked}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-300">{unit.notApplicable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-zinc-500">他的工作被誰擋住</h4>
            {row.blockedBy.length === 0 ? (
              <p className="text-xs text-zinc-400">沒有被擋住的項目。</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {row.blockedBy.map(group => (
                  <li key={group.key} className="flex items-baseline justify-between gap-2">
                    <span>{group.label}</span>
                    <span className="tabular-nums text-zinc-500">{group.count} 筆</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold text-zinc-500">REDCap 日誌歸屬</h4>
            <CreditNote row={row} />
          </div>
        </div>
      </div>
    </td>
  );
}

function OwnersBoard() {
  const { data, error, isLoading, mutate } = useSWR('/api/owners/progress', fetcher, {
    refreshInterval: 300_000,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  const refresh = useCallback(
    () => mutate(fetcher('/api/owners/progress?noCache=1'), { revalidate: false }),
    [mutate],
  );

  const nudge = useCallback(async (row: OwnerRow) => {
    if (!row.personId) return;
    setNudging(row.personId);
    setNotice('');
    try {
      const res = await fetch('/api/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: row.personId }),
      });
      const result = await res.json();
      if (!res.ok) setNotice(`寄給 ${row.displayName} 失敗：${result.error ?? res.status}`);
      else if (result.empty) setNotice(result.message);
      else {
        setNotice(`已寄給 ${row.displayName}（${result.total} 筆待辦）`);
        mutate();
      }
    } catch (err) {
      setNotice(`寄給 ${row.displayName} 失敗：${String(err)}`);
    } finally {
      setNudging(null);
    }
  }, [mutate]);

  const people = useMemo(() => data?.people ?? [], [data?.people]);
  const summary = useMemo(() => ({
    graded: people.filter(p => p.pct !== null).length,
    stalled: people.filter(p => p.stalled && p.readyCount > 0).length,
    stale: people.filter(p => p.nameSource !== 'registry').length,
    unassignedWork: (data?.unassigned ?? []).reduce((n, u) => n + u.workable, 0),
  }), [people, data?.unassigned]);

  return (
    <>
      <Header
        title="負責人進度"
        fetchedAt={data?.fetchedAt}
        onRefresh={refresh}
        isLoading={isLoading}
        owners={people.map(p => p.displayName)}
      />
      <div className="space-y-6 p-6">
        {error && <p className="text-sm text-red-600">讀取失敗：{String(error.message ?? error)}</p>}
        {notice && <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">{notice}</p>}

        {isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : !data ? null : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card><CardContent className="p-4">
                <p className="text-xs text-zinc-500">有可動工項目的人</p>
                <p className="text-2xl font-semibold tabular-nums">{summary.graded}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-zinc-500">有待辦但 {data.activity.windowDays} 天沒動作</p>
                <p className="text-2xl font-semibold tabular-nums text-amber-600">{summary.stalled}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-zinc-500">未指派的可動工項目</p>
                <p className="text-2xl font-semibold tabular-nums">{summary.unassignedWork.toLocaleString()}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-zinc-500">指派到不存在／未匯入的帳號</p>
                <p className="text-2xl font-semibold tabular-nums text-red-600">{summary.stale}</p>
              </CardContent></Card>
            </div>

            {data.readySinceKnown === 0 && (
              <p className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  事件流還沒有資料，所以「最老待辦」是空的，也沒有人會被評為「落後」——
                  落後需要有東西真的擱著超過 {data.settings.staleDays} 天才算。
                  快照 cron 至少跑過兩次之後這一欄才會有值。
                </span>
              </p>
            )}

            <Card>
              <CardHeader>
                <CardTitle>每張表</CardTitle>
                <p className="text-xs text-zinc-500">
                  分母是這張表適用的病人：檢查表看 examcheck 說有做的人，ICU 表看住進 ICU 的人。
                  「不適用」是這張表對他根本不會有的病人，兩邊都不算。
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-zinc-500">
                      <th className="p-2 pl-4">表單</th>
                      <th className="p-2">負責人</th>
                      <th className="p-2 text-right">完成 / 適用</th>
                      <th className="p-2">完成率</th>
                      <th className="p-2 text-right">可開始</th>
                      <th className="p-2 text-right" title="上游還沒給資料，不是這張表的負責人的事">被擋住</th>
                      <th className="p-2 text-right" title="這張表對這些病人根本不會有">不適用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.units.map(unit => {
                      const countsRows = unit.ruleType === 'instance_count';
                      return (
                        <tr key={unit.unitId} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <td className="p-2 pl-4">
                            <Link className="font-medium hover:underline" href={`/incomplete?unit=${unit.unitId}`}>{unit.label}</Link>
                            {countsRows && (
                              <span className="ml-1.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800" title="時序資料：看有沒有筆數，不看「完成」">
                                筆數制
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {unit.owner ? (
                              <span className={unit.owner.nameSource === 'unknown' ? 'text-red-600' : ''} title={unit.owner.nameSource !== 'registry' ? NAME_SOURCE_NOTE[unit.owner.nameSource] : undefined}>
                                {unit.owner.displayName}
                              </span>
                            ) : (
                              <Link className="text-red-600 hover:underline" href="/assign">未指派</Link>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {countsRows ? (
                              <span title={`有資料的病人數 / 適用病人數；共 ${(unit.rows ?? 0).toLocaleString()} 筆`}>
                                有資料 {(unit.patientsWithRows ?? 0).toLocaleString()} / {unit.workable.toLocaleString()}
                                <span className="ml-1 text-xs text-zinc-400">共 {(unit.rows ?? 0).toLocaleString()} 筆</span>
                              </span>
                            ) : (
                              <>{unit.done.toLocaleString()} / {unit.workable.toLocaleString()}</>
                            )}
                          </td>
                          <td className="p-2"><Bar pct={unit.pct} /></td>
                          <td className="p-2 text-right tabular-nums">{unit.ready.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums text-zinc-400">{unit.blocked.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums text-zinc-300">{unit.notApplicable.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>每個人</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-zinc-500">
                      <th className="p-2 pl-4">負責人</th>
                      <th className="p-2">成績</th>
                      <th className="p-2">完成率</th>
                      <th className="p-2 text-right">可開始</th>
                      <th className="p-2 text-right">待確認</th>
                      <th className="p-2 text-right" title="不是他的錯，不計入成績">被擋住</th>
                      <th className="p-2 text-right">最老待辦</th>
                      <th className="p-2">最近存檔 / 上次催他</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map(row => {
                      const open = expanded === row.username;
                      const lastSaveDays = daysAgo(row.lastRedcapActivity);
                      return (
                        <Fragment key={row.username}>
                          <tr
                            className="cursor-pointer border-b hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            onClick={() => setExpanded(open ? null : row.username)}
                          >
                            <td className="p-2 pl-4">
                              <div className="flex items-center gap-1.5">
                                {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
                                <span className="font-medium">{row.displayName}</span>
                                {row.nameSource !== 'registry' && (
                                  <span title={NAME_SOURCE_NOTE[row.nameSource]}>
                                    <UserX className="h-3.5 w-3.5 text-red-500" />
                                  </span>
                                )}
                              </div>
                              <span className="pl-5 text-xs text-zinc-400">{row.username}</span>
                            </td>
                            <td className="p-2">
                              <span className={`rounded px-1.5 py-0.5 text-xs ${GRADE_STYLES[row.grade]}`}>{row.grade}</span>
                              {row.stalled && row.readyCount > 0 && (
                                <span className="ml-1 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" title={`${data.activity.windowDays} 天內在 REDCap 沒有存檔`}>
                                  停滯
                                </span>
                              )}
                            </td>
                            <td className="p-2"><Bar pct={row.pct} /></td>
                            <td className="p-2 text-right tabular-nums">{row.readyCount.toLocaleString()}</td>
                            <td className="p-2 text-right tabular-nums">{row.awaitingVerifyCount.toLocaleString()}</td>
                            <td className="p-2 text-right tabular-nums text-zinc-400">{row.blockedCount.toLocaleString()}</td>
                            <td className="p-2 text-right tabular-nums">
                              {row.oldestReadyDays === null
                                ? <span className="text-zinc-300">—</span>
                                : <span className={row.oldestReadyDays > data.settings.staleDays ? 'text-red-600' : ''}>{row.oldestReadyDays} 天</span>}
                            </td>
                            <td className="p-2" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500" title={row.lastRedcapActivity ?? `過去 ${data.activity.logMonths} 個月的日誌裡沒有他的存檔`}>
                                  {lastSaveDays === null ? `${data.activity.logMonths} 個月內無` : `${lastSaveDays} 天前`}
                                </span>
                                <span className="text-zinc-300">/</span>
                                <span className="text-xs text-zinc-500">{taipeiDate(row.lastNudgedAt)}</span>
                                {row.personId && row.email ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={nudging === row.personId || row.readyCount + row.awaitingVerifyCount === 0}
                                    title={row.readyCount + row.awaitingVerifyCount === 0 ? '沒有可以進行的項目，不需要提醒' : '寄一封目前待辦清單給他'}
                                    onClick={() => nudge(row)}
                                  >
                                    {nudging === row.personId ? <MailCheck className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                                    提醒
                                  </Button>
                                ) : (
                                  <span className="text-xs text-zinc-400" title={NAME_SOURCE_NOTE[row.nameSource]}>無信箱</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {open && <tr className="border-b"><OwnerDetail row={row} /></tr>}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {data.unassigned.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>沒有人負責的單元</CardTitle>
                  <p className="text-xs text-zinc-500">
                    這些單元沒有出現在任何人的成績、待辦或提醒信裡。到 <Link className="underline" href="/assign">/assign</Link> 指派負責人。
                  </p>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="p-2 pl-4">單元</th>
                        <th className="p-2 text-right">可動工</th>
                        <th className="p-2 text-right">可開始</th>
                        <th className="p-2 text-right">待確認</th>
                        <th className="p-2 text-right">被擋住</th>
                        <th className="p-2 text-right">已完成</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unassigned.map(unit => (
                        <tr key={unit.unitId} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <td className="p-2 pl-4">
                            <Link className="hover:underline" href={`/incomplete?unit=${unit.unitId}`}>{unit.label}</Link>
                          </td>
                          <td className="p-2 text-right font-medium tabular-nums">{unit.workable.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">{unit.counts.ready.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums">{unit.counts.entered_awaiting_verify.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums text-zinc-400">{unit.counts.blocked.toLocaleString()}</td>
                          <td className="p-2 text-right tabular-nums text-zinc-400">{unit.counts.complete.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>依擋住者分組</CardTitle>
                <p className="text-xs text-zinc-500">被擋住的工作沒有消失，只是換了一個人的名字——這是「該去催誰」最快的一張表。</p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {data.blockers.length === 0 ? (
                  <p className="p-6 text-sm text-zinc-500">目前沒有被擋住的項目。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="p-2 pl-4">在等什麼</th>
                        <th className="p-2 text-right">卡住的筆數</th>
                        <th className="p-2">卡住的單元</th>
                        <th className="p-2">動作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blockers.map(group => {
                        const owner = group.owner;
                        const target = owner ? people.find(p => p.username === owner.username) : undefined;
                        return (
                          <tr key={group.key} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-800">
                            <td className="p-2 pl-4">{group.label}</td>
                            <td className="p-2 text-right font-medium tabular-nums">{group.count.toLocaleString()}</td>
                            <td className="p-2 text-xs text-zinc-500">
                              {group.waitingUnits.slice(0, 3).map(u => `${u.label}（${u.count}）`).join('、')}
                              {group.waitingUnits.length > 3 && ` 等 ${group.waitingUnits.length} 個單元`}
                            </td>
                            <td className="p-2">
                              {target?.personId && target.email ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={nudging === target.personId}
                                  onClick={() => nudge(target)}
                                >
                                  <Mail className="h-3 w-3" />
                                  催 {target.displayName}
                                </Button>
                              ) : (
                                <span className="text-xs text-zinc-400">{owner ? '無信箱' : '不是某個人'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-zinc-400">
              成績 = 已完成 ÷ 適用且未被擋住的項目。被擋住與不適用的項目兩邊都不計。
              檢查表以 examcheck 決定適不適用；時序表（Lab、Vital）看有沒有筆數，不看「完成」；一筆一事件的表要每一筆都完成。
              助理表單填完待醫師簽核時，對助理算完成、對醫師算未完成。
              「落後」除了成績低，還要有項目真的擱著超過 {data.settings.staleDays} 天。
              REDCap 日誌範圍：{data.activity.exportStart ? `${taipeiDate(data.activity.exportStart)} 起` : '無資料'}
              （可歸屬存檔 {data.attribution.attributableSaves.toLocaleString()} 筆、
              未標明表單 {data.attribution.formlessSaves.toLocaleString()} 筆）。
            </p>
          </>
        )}
      </div>
    </>
  );
}

export default function OwnersPage() {
  return (
    <AdminGate>
      <OwnersBoard />
    </AdminGate>
  );
}
