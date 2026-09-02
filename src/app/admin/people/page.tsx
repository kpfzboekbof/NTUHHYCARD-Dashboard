'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Lock, Download, Save, UserPlus, AlertTriangle } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ALL_ROLES, ROLE_LABELS, type Role } from '@/lib/auth/roles';

/**
 * The people registry — who the form owners are, across the whole project.
 *
 * A person here is a name, a REDCap account, an address and a set of roles.
 * That is what every other view needs to stop matching people by display-name
 * string, and it is all this page owns.
 *
 * The etiology labeler code (0/3/5/6/7) is deliberately not here: it belongs to
 * one form's dropdown, not to the project's roster, and is linked on /etiology
 * beside the labelers it names. `person.labeler_code` still stores it — this
 * page simply never sends the field, so editing somebody here cannot disturb
 * a link made there.
 */

interface Person {
  id: string;
  redcapUsername: string | null;
  displayName: string;
  email: string;
  roles: Role[];
  broadcastOptOut: boolean;
  notifyPref: string;
  active: boolean;
}

interface ImportResult {
  dryRun?: boolean;
  created: number;
  updated: number;
  skipped?: { username: string; reason: string }[];
  failed?: { username: string; reason: string }[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

export default function PeoplePage() {
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
      if (res.ok) {
        setAuthenticated(true);
        setPassword('');
      } else {
        setAuthError(data.error || '登入失敗');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const { data, error, mutate, isLoading } = useSWR<{ people: Person[] }>(
    authenticated ? '/api/admin/people?includeInactive=1' : null,
    fetcher,
  );

  const [draft, setDraft] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  const people = useMemo(() => data?.people ?? [], [data]);

  const runImport = useCallback(async (dryRun: boolean) => {
    setImporting(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/people/import${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!res.ok) {
        setMessage(result.error || '匯入失敗');
        return;
      }
      setImportResult({ ...result, dryRun });
      if (!dryRun) await mutate();
    } finally {
      setImporting(false);
    }
  }, [mutate]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/people', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          displayName: draft.displayName,
          email: draft.email,
          redcapUsername: draft.redcapUsername,
          roles: draft.roles,
          broadcastOptOut: draft.broadcastOptOut,
          active: draft.active,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setMessage(result.error || '儲存失敗');
        return;
      }
      setDraft(null);
      await mutate();
    } finally {
      setSaving(false);
    }
  }, [draft, mutate]);

  if (authenticated === null) {
    return <div className="flex h-screen items-center justify-center text-zinc-500">驗證中...</div>;
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Card className="w-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />管理員登入
            </CardTitle>
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
      <Header title="人員登記" />
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />從 REDCap 匯入
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              以 REDCap 使用者清單（帳號、姓名、email）建立或更新人員。已用 email 登入過的人會被連上既有資料，不會產生第二列。
              角色一律從「檢視」開始，要給誰更高權限請在下方逐一設定。
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={importing} onClick={() => runImport(true)}>
                <Download className="mr-2 h-4 w-4" />預覽
              </Button>
              <Button disabled={importing} onClick={() => runImport(false)}>
                {importing ? '匯入中...' : '執行匯入'}
              </Button>
            </div>

            {importResult && (
              <div className="rounded border bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                <p>
                  {importResult.dryRun ? '預覽：' : '已完成：'}
                  新增 {importResult.created} 人、更新 {importResult.updated} 人
                </p>
                {importResult.skipped && importResult.skipped.length > 0 && (
                  <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-500">
                    {importResult.skipped.map(s => (
                      <li key={s.username}>略過 {s.username}：{s.reason}</li>
                    ))}
                  </ul>
                )}
                {importResult.failed && importResult.failed.length > 0 && (
                  <ul className="mt-2 space-y-1 text-red-700 dark:text-red-500">
                    {importResult.failed.map(f => (
                      <li key={f.username}>失敗 {f.username}：{f.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {message && (
          <p className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />{message}
          </p>
        )}

        {error && (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">
              讀取人員失敗：{String(error.message ?? error)}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>人員（{people.length}）</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <p className="text-sm text-zinc-500">載入中...</p>
            ) : people.length === 0 ? (
              <p className="text-sm text-zinc-500">還沒有任何人員，先執行上面的匯入。</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="p-2">姓名</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">REDCap 帳號</th>
                    <th className="p-2">角色</th>
                    <th className="p-2">不收群組信</th>
                    <th className="p-2">啟用</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(person => {
                    const editing = draft?.id === person.id;
                    const row = editing && draft ? draft : person;
                    return (
                      <tr key={person.id} className="border-b last:border-0">
                        <td className="p-2">
                          {editing ? (
                            <input
                              className="w-28 rounded border px-2 py-1"
                              value={row.displayName}
                              onChange={e => setDraft({ ...row, displayName: e.target.value })}
                            />
                          ) : row.displayName}
                        </td>
                        <td className="p-2 text-zinc-600 dark:text-zinc-400">
                          {editing ? (
                            <input
                              className="w-56 rounded border px-2 py-1"
                              value={row.email}
                              onChange={e => setDraft({ ...row, email: e.target.value })}
                            />
                          ) : row.email}
                        </td>
                        <td className="p-2">
                          {editing ? (
                            <input
                              className="w-24 rounded border px-2 py-1"
                              value={row.redcapUsername ?? ''}
                              onChange={e => setDraft({ ...row, redcapUsername: e.target.value || null })}
                            />
                          ) : (row.redcapUsername ?? <span className="text-zinc-400">—</span>)}
                        </td>
                        <td className="p-2">
                          {editing ? (
                            <div className="flex flex-wrap gap-2">
                              {ALL_ROLES.map(role => (
                                <label key={role} className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={row.roles.includes(role)}
                                    onChange={e => setDraft({
                                      ...row,
                                      roles: e.target.checked
                                        ? [...row.roles, role]
                                        : row.roles.filter(r => r !== role),
                                    })}
                                  />
                                  {ROLE_LABELS[role]}
                                </label>
                              ))}
                            </div>
                          ) : row.roles.map(r => ROLE_LABELS[r] ?? r).join('、')}
                        </td>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={!editing}
                            checked={row.broadcastOptOut}
                            onChange={e => setDraft({ ...row, broadcastOptOut: e.target.checked })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={!editing}
                            checked={row.active}
                            onChange={e => setDraft({ ...row, active: e.target.checked })}
                          />
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {editing ? (
                            <>
                              <Button size="sm" disabled={saving} onClick={saveDraft}>
                                <Save className="mr-1 h-3 w-3" />{saving ? '儲存中' : '儲存'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>取消</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setDraft(person)}>編輯</Button>
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
      </div>
    </>
  );
}
