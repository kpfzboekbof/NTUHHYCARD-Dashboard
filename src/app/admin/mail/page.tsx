'use client';

import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { Lock, MailCheck, MailX, Clock } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * The delivery ledger, readable.
 *
 * One global reminderSentAt could not answer "how many times was this person
 * chased this month" or "did that mail actually leave" — this page can, row by
 * row, failures included.
 */

interface MailRow {
  id: string;
  toPersonName: string | null;
  toEmail: string;
  kind: string;
  payload: unknown;
  requestedByName: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  nudge: '催辦',
  meeting_reminder: '會議提醒',
  batch_due: '批次到期',
  scan_missing: 'Scraper 缺檔警報',
  snapshot_stale: '快照停擺警報',
  login_link: '登入連結',
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as { mail: MailRow[] };
};

export default function MailLedgerPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then(r => r.json())
      .then(d => setAuthenticated(!!d.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  const handleLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) setAuthenticated(true);
      else setAuthError(data.error || '登入失敗');
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const [kind, setKind] = useState('');
  const { data, error, isLoading } = useSWR(
    authenticated ? `/api/outbound-mail?limit=200${kind ? `&kind=${kind}` : ''}` : null,
    fetcher,
  );

  if (authenticated === null) {
    return <div className="flex h-screen items-center justify-center text-zinc-500">驗證中...</div>;
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Card className="w-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />管理員登入</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleLogin(); }}>
              <input
                type="password"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="管理者密碼"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              {authError && <p className="text-sm text-red-600">{authError}</p>}
              <Button type="submit" className="w-full" disabled={authLoading}>
                {authLoading ? '登入中...' : '登入'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Header title="寄信紀錄" />
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3 text-sm">
          <label className="text-zinc-500">類型：</label>
          <select className="rounded border px-2 py-1" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">全部</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">讀取失敗：{String(error.message ?? error)}</p>}

        <Card>
          <CardContent className="overflow-x-auto p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-zinc-500">載入中...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="p-2 pl-4">時間</th>
                    <th className="p-2">類型</th>
                    <th className="p-2">收件人</th>
                    <th className="p-2">狀態</th>
                    <th className="p-2">內容摘要</th>
                    <th className="p-2">操作者</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.mail ?? []).map(row => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-2 pl-4 whitespace-nowrap text-zinc-500">
                        {row.createdAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="p-2">{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td className="p-2">
                        {row.toPersonName ? `${row.toPersonName}（${row.toEmail}）` : row.toEmail}
                      </td>
                      <td className="p-2">
                        {row.sentAt ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <MailCheck className="h-3.5 w-3.5" />已寄出
                          </span>
                        ) : row.error ? (
                          <span className="inline-flex items-center gap-1 text-red-600" title={row.error}>
                            <MailX className="h-3.5 w-3.5" />失敗
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <Clock className="h-3.5 w-3.5" />未確認
                          </span>
                        )}
                      </td>
                      <td className="max-w-md truncate p-2 text-zinc-500" title={JSON.stringify(row.payload)}>
                        {typeof row.payload === 'object' && row.payload && 'units' in (row.payload as object)
                          ? (row.payload as { units: Array<{ label: string; ready: number; awaiting: number }> })
                              .units.map(u => `${u.label} ${u.ready + u.awaiting}`).join('、')
                          : JSON.stringify(row.payload).slice(0, 80)}
                      </td>
                      <td className="p-2">{row.requestedByName ?? '系統'}</td>
                    </tr>
                  ))}
                  {(data?.mail ?? []).length === 0 && !isLoading && (
                    <tr><td colSpan={6} className="p-6 text-center text-zinc-400">還沒有任何寄信紀錄</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
