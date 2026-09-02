'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, PlayCircle, XCircle } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { AdminGate } from '@/components/admin-gate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CronStatusResponse } from '@/app/api/admin/cron-runs/route';
import type { JobStatus } from '@/lib/cron/health';

/**
 * 系統狀態 — whether the background jobs are actually running.
 *
 * The dashboard depends on a nightly snapshot for anything with a "since
 * when" in it, and a job that runs with nobody watching fails as silently as
 * it succeeds. This page is the answer to "has it been running?", asked from
 * inside the system that depends on it rather than from a log that expires.
 */

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as CronStatusResponse;
};

const STATUS_LABEL: Record<JobStatus, string> = {
  ok: '正常',
  stale: '太久沒跑',
  failing: '執行失敗',
  stuck: '中途被砍掉',
  running: '執行中',
  never: '從未執行',
};

const STATUS_STYLE: Record<JobStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  stale: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  failing: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  stuck: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  never: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
};

/** What each state means and what to do about it — the point of naming them apart. */
const STATUS_NOTE: Record<JobStatus, string> = {
  ok: '',
  stale: '沒有錯誤訊息，就只是沒有被執行。先確認 Vercel 的 Cron Jobs 分頁有沒有這個排程。',
  failing: '有結束、也留下了錯誤訊息，看下面那一列的錯誤內容。',
  stuck: '開始了但沒有回報結束，幾乎都是被平台的函式時間上限砍掉。若常發生，這個工作要拆小。',
  running: '',
  never: '完全沒有紀錄：排程可能沒註冊，或每一次呼叫都在開始前就被擋掉（例如缺 CRON_SECRET）。',
};

const STATUS_ICON: Record<JobStatus, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle2, stale: Clock, failing: XCircle,
  stuck: AlertTriangle, running: PlayCircle, never: HelpCircle,
};

function taipeiTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function SystemBoard() {
  const { data, error, isLoading, mutate } = useSWR('/api/admin/cron-runs', fetcher, {
    refreshInterval: 60_000,
  });
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const runNow = useCallback(async (job: string) => {
    setRunning(job);
    setNotice('');
    try {
      // The same URL the scheduler calls; a manager session authorises it, and
      // the ledger records it as a manual run so the two never blur together.
      const res = await fetch(`/api/cron/${job}`);
      const result = await res.json();
      setNotice(res.ok
        ? `${job} 執行完成：${JSON.stringify(result)}`
        : `${job} 執行失敗：${result.error ?? res.status}`);
      mutate();
    } catch (err) {
      setNotice(`${job} 執行失敗：${String(err)}`);
    } finally {
      setRunning(null);
    }
  }, [mutate]);

  return (
    <>
      <Header title="系統狀態" fetchedAt={data?.fetchedAt} onRefresh={() => mutate()} isLoading={isLoading} />
      <div className="space-y-6 p-6">
        {error && <p className="text-sm text-red-600">讀取失敗：{String(error.message ?? error)}</p>}
        {notice && (
          <p className="overflow-x-auto whitespace-pre-wrap rounded border border-blue-200 bg-blue-50 px-3 py-2 font-mono text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
            {notice}
          </p>
        )}

        {isLoading && !data ? (
          <div className="py-20 text-center text-zinc-400">載入中...</div>
        ) : !data ? null : (
          <>
            {!data.hasDatabase && (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                沒有設定 OHCA_DATABASE_URL，執行紀錄無處可寫。下面只有基準線那一項是真的。
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {data.jobs.map(job => {
                const Icon = STATUS_ICON[job.status];
                return (
                  <Card key={job.job}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          {job.label}
                          <span className={`rounded px-1.5 py-0.5 text-xs font-normal ${STATUS_STYLE[job.status]}`}>
                            <Icon className="mr-1 inline h-3 w-3" />
                            {STATUS_LABEL[job.status]}
                          </span>
                        </CardTitle>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={running !== null}
                          onClick={() => runNow(job.job)}
                        >
                          {running === job.job ? '執行中...' : '立刻執行'}
                        </Button>
                      </div>
                      <p className="font-mono text-xs text-zinc-400">/api/cron/{job.job}</p>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">最近一次成功</span>
                        <span>
                          {taipeiTime(job.lastOk?.startedAt ?? null)}
                          {job.hoursSinceSuccess !== null && (
                            <span className="ml-1 text-xs text-zinc-400">
                              （{Math.round(job.hoursSinceSuccess)} 小時前）
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">最近一次執行</span>
                        <span>
                          {taipeiTime(job.last?.startedAt ?? null)}
                          {job.last && (
                            <span className="ml-1 text-xs text-zinc-400">
                              （{job.last.trigger === 'schedule' ? '排程' : `手動${job.last.actorName ? `／${job.last.actorName}` : ''}`}）
                            </span>
                          )}
                        </span>
                      </div>
                      {job.last?.error && (
                        <p className="rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                          {job.last.error}
                        </p>
                      )}
                      {STATUS_NOTE[job.status] && (
                        <p className="text-xs text-zinc-500">{STATUS_NOTE[job.status]}</p>
                      )}
                      {job.scheduleSuspect && (
                        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            紀錄裡每一次成功都是手動觸發的。看起來正常，但排程本身沒有在跑——
                            你一停手，資料就會安靜地停下來。
                          </span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">狀態基準線</CardTitle>
                <p className="text-xs text-zinc-500">
                  快照 cron 每天寫下的整份矩陣。下一次執行拿它來比對，算出「今天哪些工作變成可以開始了」——
                  <code className="mx-1">/owners</code> 的「最老待辦」就是從這裡來的。
                  它的寫入時間也是唯一早於執行紀錄的證據。
                </p>
              </CardHeader>
              <CardContent className="text-sm">
                {data.baseline.exists === null ? (
                  <p className="text-zinc-500">連不上 Blob 儲存空間，這一項無法判斷（不代表基準線不存在）。</p>
                ) : data.baseline.exists ? (
                  <div className="flex flex-wrap gap-6">
                    <span>寫入時間：<span className="font-medium">{taipeiTime(data.baseline.uploadedAt)}</span></span>
                    <span className="text-zinc-500">
                      大小：{data.baseline.bytes ? `${(data.baseline.bytes / 1024 / 1024).toFixed(2)} MB` : '—'}
                    </span>
                  </div>
                ) : (
                  <p className="text-amber-700 dark:text-amber-400">
                    還沒有基準線：快照從來沒有成功跑完過。按上面的「立刻執行」建立第一份，
                    隔天再跑一次才會開始有交接事件——第一次沒有東西可以比對。
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">執行紀錄</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {data.runs.length === 0 ? (
                  <p className="p-6 text-sm text-zinc-500">
                    還沒有任何紀錄。這張表從這次部署才開始記，所以在那之前的執行不會出現在這裡。
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="p-2 pl-4">開始</th>
                        <th className="p-2">工作</th>
                        <th className="p-2">觸發</th>
                        <th className="p-2">結果</th>
                        <th className="p-2 text-right">耗時</th>
                        <th className="p-2">內容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.runs.map(run => (
                        <tr key={run.id} className="border-b last:border-0">
                          <td className="p-2 pl-4 whitespace-nowrap">{taipeiTime(run.startedAt)}</td>
                          <td className="p-2">{run.job}</td>
                          <td className="p-2 text-xs text-zinc-500">
                            {run.trigger === 'schedule' ? '排程' : `手動${run.actorName ? `／${run.actorName}` : ''}`}
                          </td>
                          <td className="p-2">
                            {run.finishedAt === null ? (
                              <span className="text-amber-600">沒有回報結束</span>
                            ) : run.ok ? (
                              <span className="text-emerald-600">成功</span>
                            ) : (
                              <span className="text-red-600">失敗</span>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums text-zinc-500">{duration(run.tookMs)}</td>
                          <td className="max-w-md truncate p-2 font-mono text-xs text-zinc-500" title={run.error ?? JSON.stringify(run.result)}>
                            {run.error ?? JSON.stringify(run.result)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

export default function SystemPage() {
  return (
    <AdminGate>
      <SystemBoard />
    </AdminGate>
  );
}
