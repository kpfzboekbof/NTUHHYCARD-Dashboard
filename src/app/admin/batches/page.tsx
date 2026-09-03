'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Plus, Send, Eye, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminGate } from '@/components/admin-gate';
import { deadlinePhrase } from '@/lib/deadline';

/**
 * Batches: set a deadline and a study-id cutoff, see who is short and by how
 * much, then send everyone their own list in one press.
 *
 * The preview is mandatory before the first send — not as friction, but
 * because it is what makes one click safe: it is the same computation the send
 * performs, so what is shown is what goes out.
 */

interface UnitRef { unitId: string; label: string; deepLinkPage: string }

interface PersonBacklog {
  personId: string | null;
  username: string;
  displayName: string;
  nameSource: 'registry' | 'directory' | 'unknown';
  email: string | null;
  units: Array<{ unitId: string; label: string; ready: string[]; awaiting: string[] }>;
  readyCount: number;
  awaitingCount: number;
  total: number;
}

interface BatchWithProgress {
  id: string;
  name: string;
  studyIdCutoff: number;
  dueDate: string | null;
  unitIds: string[];
  closedAt: string | null;
  backlog: PersonBacklog[];
  total: number;
  fetchedAt: string | null;
}

interface BatchesResponse {
  batches: BatchWithProgress[];
  units: UnitRef[];
  lastNudge: Record<string, string>;
}

interface Preview {
  recipients: Array<{
    personId: string;
    displayName: string;
    email: string;
    total: number;
    readyCount: number;
    awaitingCount: number;
    units: Array<{ label: string; remaining: number }>;
    subject: string;
  }>;
  unreachable: Array<{ username: string; displayName: string; total: number; reason: string }>;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as BatchesResponse;
};

function taipeiDay(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' });
}

function NewBatchForm({ units, onCreated }: { units: UnitRef[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          studyIdCutoff: Number(cutoff),
          dueDate: dueDate || null,
          unitIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '建立失敗'); return; }
      setOpen(false); setName(''); setCutoff(''); setDueDate(''); setUnitIds([]);
      onCreated();
    } finally {
      setSaving(false);
    }
  }, [name, cutoff, dueDate, unitIds, onCreated]);

  if (!open) {
    return <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />新增批次</Button>;
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">新增批次</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">批次名稱</span>
            <input className="w-56 rounded border px-2 py-1" placeholder="例：第三批基本表單"
              value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">收案編號 ≤</span>
            <input type="number" className="w-32 rounded border px-2 py-1" placeholder="5000"
              value={cutoff} onChange={e => setCutoff(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">截止日</span>
            <input type="date" className="rounded border px-2 py-1"
              value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </label>
        </div>

        <div className="text-sm">
          <p className="mb-2 text-zinc-500">
            涵蓋表單（不勾則涵蓋全部——只設編號與日期就能用）
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {units.map(u => (
              <label key={u.unitId} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={unitIds.includes(u.unitId)}
                  onChange={e => setUnitIds(prev =>
                    e.target.checked ? [...prev, u.unitId] : prev.filter(id => id !== u.unitId))}
                />
                {u.label}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={saving || !name.trim() || !cutoff} onClick={submit}>
            {saving ? '建立中...' : '建立'}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Nobody can be mailed until the registry has been seeded, and the page must
 * say so once at the top rather than leaving a column of orange markers for
 * the operator to decode.
 */
function ReachabilityHint({ batches }: { batches: BatchWithProgress[] }) {
  const everyone = batches.flatMap(b => b.backlog);
  if (everyone.length === 0) return null;

  const notImported = new Set(everyone.filter(p => p.nameSource === 'directory').map(p => p.username));
  const stale = new Set(everyone.filter(p => p.nameSource === 'unknown').map(p => p.username));
  if (notImported.size === 0 && stale.size === 0) return null;

  return (
    <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {notImported.size > 0 && (
        <p>
          <strong>{notImported.size} 位負責人還不能寄信</strong>：REDCap 知道他們是誰，但還沒匯入人員登記表，所以沒有 email。
          到 <a className="underline" href="/admin/people">人員登記</a> 按「從 REDCap 匯入」即可，一次匯完。
        </p>
      )}
      {stale.size > 0 && (
        <p>
          <strong>{stale.size} 筆指派已失效</strong>（{[...stale].join('、')}）：REDCap 的使用者清單裡沒有這些帳號，
          匯入也救不了。請到 <a className="underline" href="/assign">管理者</a> 改指派給現任的人。
        </p>
      )}
    </div>
  );
}

function BatchCard({ batch, lastNudge, onChanged }: {
  batch: BatchWithProgress;
  lastNudge: Record<string, string>;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const phrase = batch.dueDate ? deadlinePhrase(batch.dueDate) : '';
  const overdue = phrase.startsWith('已逾期');

  const loadPreview = useCallback(async () => {
    setBusy(true);
    setResult('');
    try {
      const res = await fetch('/api/batches/send?dryRun=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batch.id, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setResult(data.error || '預覽失敗'); return; }
      setPreview(data);
      setSelected(new Set(data.recipients.map((r: { personId: string }) => r.personId)));
    } finally {
      setBusy(false);
    }
  }, [batch.id, note]);

  const send = useCallback(async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setResult('');
    try {
      const res = await fetch('/api/batches/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: batch.id,
          personIds: [...selected],
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setResult(data.error || '寄送失敗'); return; }
      const failed = data.failed?.length ?? 0;
      setResult(failed === 0
        ? `已寄出 ${data.sent} 封`
        : `寄出 ${data.sent} 封，${failed} 封失敗：${data.failed.map((f: { email: string; error: string }) => `${f.email}（${f.error}）`).join('、')}`);
      setPreview(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [batch.id, selected, note, onChanged]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <span>{batch.name}</span>
          <span className="font-normal text-zinc-500">收案編號 ≤ {batch.studyIdCutoff}</span>
          {batch.dueDate && (
            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal ${
              overdue ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                      : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>
              <CalendarClock className="h-3.5 w-3.5" />{batch.dueDate}　{phrase}
            </span>
          )}
          <span className="ml-auto text-sm font-normal">
            {batch.total === 0
              ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />全部完成</span>
              : <>還缺 <strong>{batch.total}</strong> 筆</>}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {batch.unitIds.length > 0 && (
          <p className="text-xs text-zinc-500">只涵蓋 {batch.unitIds.length} 張指定表單</p>
        )}

        {batch.backlog.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-zinc-500">
                <th className="p-2 pl-0">負責人</th>
                <th className="p-2">還缺</th>
                <th className="p-2">尚未填寫</th>
                <th className="p-2">待確認</th>
                <th className="p-2">上次催辦</th>
                <th className="p-2">主要缺在哪</th>
              </tr>
            </thead>
            <tbody>
              {batch.backlog.map(person => {
                const last = person.personId ? lastNudge[person.personId] : undefined;
                return (
                  <tr key={person.username} className="border-b last:border-0">
                    <td className="p-2 pl-0">
                      {person.displayName}
                      {person.nameSource === 'directory' && (
                        <span
                          className="ml-1 text-xs text-amber-600"
                          title={`${person.username} 在 REDCap 有這個人，但還沒匯入人員登記表，所以沒有 email 可以寄`}
                        >
                          （未匯入）
                        </span>
                      )}
                      {person.nameSource === 'unknown' && (
                        <span
                          className="ml-1 text-xs text-red-600"
                          title="REDCap 的使用者清單裡沒有這個帳號——這筆指派已經失效，請到 /assign 改指派給現任的人"
                        >
                          （REDCap 查無此帳號）
                        </span>
                      )}
                      {person.nameSource === 'registry' && !person.email && (
                        <span className="ml-1 text-xs text-amber-600" title="人員資料沒有 email，無法寄信">
                          （缺 email）
                        </span>
                      )}
                    </td>
                    <td className="p-2 font-medium">{person.total}</td>
                    <td className="p-2 text-zinc-500">{person.readyCount}</td>
                    <td className="p-2 text-zinc-500">{person.awaitingCount}</td>
                    <td className="p-2 text-zinc-500">{last ? taipeiDay(last) : '—'}</td>
                    <td className="p-2 text-zinc-500">
                      {person.units.slice(0, 3).map(u => `${u.label} ${u.ready.length + u.awaiting.length}`).join('、')}
                      {person.units.length > 3 && ' …'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {batch.total > 0 && (
          <div className="space-y-3 border-t pt-3">
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="想附帶的一句話（選填，會出現在每封信裡）"
              value={note}
              onChange={e => setNote(e.target.value)}
            />

            {!preview ? (
              <Button variant="outline" disabled={busy} onClick={loadPreview}>
                <Eye className="mr-1 h-4 w-4" />{busy ? '計算中...' : '預覽要寄給誰'}
              </Button>
            ) : (
              <div className="space-y-3 rounded border bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  將寄給 {selected.size} / {preview.recipients.length} 人：
                </p>
                <ul className="space-y-1 text-sm">
                  {preview.recipients.map(r => (
                    <li key={r.personId} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(r.personId)}
                        onChange={e => setSelected(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.personId); else next.delete(r.personId);
                          return next;
                        })}
                      />
                      <span>
                        <strong>{r.displayName}</strong>（{r.email}）還缺 {r.total} 筆
                        <br />
                        <span className="text-xs text-zinc-500">主旨：{r.subject}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                {preview.unreachable.length > 0 && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <p className="mb-1 flex items-center gap-1 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />這些人有待辦但寄不出去
                    </p>
                    {preview.unreachable.map(u => (
                      <p key={u.username}>{u.displayName}（{u.total} 筆）：{u.reason}</p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button disabled={busy || selected.size === 0} onClick={send}>
                    <Send className="mr-1 h-4 w-4" />{busy ? '寄送中...' : `一鍵寄出（${selected.size} 封）`}
                  </Button>
                  <Button variant="ghost" onClick={() => setPreview(null)}>取消</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {result && <p className="text-sm text-blue-700 dark:text-blue-300">{result}</p>}

        <div className="flex items-center gap-3 border-t pt-3 text-xs text-zinc-400">
          {batch.fetchedAt && <span>資料時間 {taipeiDay(batch.fetchedAt)}</span>}
          <button
            className="ml-auto underline-offset-2 hover:underline"
            onClick={async () => {
              await fetch('/api/batches', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: batch.id, closed: true }),
              });
              onChanged();
            }}
          >
            結束這個批次
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BatchesPage() {
  return (
    <AdminGate prefetch={['/api/batches']}>
      <BatchesView />
    </AdminGate>
  );
}

function BatchesView() {
  const { data, error, isLoading, mutate } = useSWR<BatchesResponse>('/api/batches', fetcher, {
    revalidateOnFocus: false,
  });

  const units = useMemo(() => data?.units ?? [], [data]);

  return (
    <>
      <Header title="批次目標" />
      <div className="space-y-4 p-6">
        <p className="text-sm text-zinc-500">
          設定「收案編號 ≤ N 要在某日前完成」，系統算出每個人還缺幾筆，預覽後一鍵把各自的清單寄給他們。
          清單只含現在就能動工的項目——還在等別人先填的不會拿來催人。
        </p>

        <NewBatchForm units={units} onCreated={() => mutate()} />

        {data && <ReachabilityHint batches={data.batches} />}

        {error && <p className="text-sm text-red-600">讀取失敗：{String(error.message ?? error)}</p>}
        {isLoading && <p className="text-sm text-zinc-500">計算各批次進度中...（需要推導狀態矩陣，約一分鐘）</p>}

        {(data?.batches ?? []).map(batch => (
          <BatchCard
            key={batch.id}
            batch={batch}
            lastNudge={data?.lastNudge ?? {}}
            onChanged={() => mutate()}
          />
        ))}

        {data && data.batches.length === 0 && (
          <Card><CardContent className="p-6 text-center text-sm text-zinc-400">
            還沒有任何批次。按上面的「新增批次」建立第一個。
          </CardContent></Card>
        )}
      </div>
    </>
  );
}
