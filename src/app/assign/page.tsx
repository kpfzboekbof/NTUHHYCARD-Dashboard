'use client';

import { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { Lock, LogOut } from 'lucide-react';
import { useCompletionData } from '@/hooks/use-completion-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FORMS } from '@/config/forms';
import type { User, OwnerAssignments } from '@/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AssignPage() {
  const { data: compData, refresh } = useCompletionData();
  const { data: ownerData, mutate: mutateOwners } = useSWR<{ users: User[]; assignments: OwnerAssignments; hiddenForms: string[]; targetIds: { basic: number | null; exam: number | null }; labelers: { code: number; name: string }[] }>(
    '/api/owners', fetcher
  );

  // Auth state
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => setAuthenticated(d.authenticated));
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

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setAuthenticated(false);
  }, []);

  // Editor state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OwnerAssignments>({});
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [draftTargetBasic, setDraftTargetBasic] = useState<string>('');
  const [draftTargetExam, setDraftTargetExam] = useState<string>('');
  const [draftLabelers, setDraftLabelers] = useState<{ code: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const startEdit = useCallback(() => {
    setDraft(ownerData?.assignments ?? {});
    setDraftHidden(new Set(ownerData?.hiddenForms ?? []));
    setDraftTargetBasic(ownerData?.targetIds?.basic?.toString() ?? '');
    setDraftTargetExam(ownerData?.targetIds?.exam?.toString() ?? '');
    setDraftLabelers((ownerData?.labelers ?? []).map(l => ({ code: l.code.toString(), name: l.name })));
    setEditing(true);
  }, [ownerData]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const toggleHidden = useCallback((formName: string) => {
    setDraftHidden(prev => {
      const next = new Set(prev);
      if (next.has(formName)) next.delete(formName);
      else next.add(formName);
      return next;
    });
  }, []);

  const saveAssignments = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/owners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: draft,
          hiddenForms: Array.from(draftHidden),
          targetIds: {
            basic: draftTargetBasic ? parseInt(draftTargetBasic) : null,
            exam: draftTargetExam ? parseInt(draftTargetExam) : null,
          },
          labelers: draftLabelers
            .filter(l => l.code && l.name)
            .map(l => ({ code: parseInt(l.code), name: l.name })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '儲存失敗');
        return;
      }
      await mutateOwners();
      await fetch('/api/refresh', { method: 'POST' });
      refresh();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, draftHidden, draftTargetBasic, draftTargetExam, mutateOwners, refresh]);

  const users = ownerData?.users ?? compData?.users ?? [];
  const hiddenForms = new Set(ownerData?.hiddenForms ?? []);

  // Loading auth check
  if (authenticated === null) {
    return (
      <div>
        <Header title="管理者頁面" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-zinc-400">驗證中...</div>
        </div>
      </div>
    );
  }

  // Login screen
  if (!authenticated) {
    return (
      <div>
        <Header title="管理者頁面" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Card className="w-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                管理員登入
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <input
                  type="password"
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="請輸入管理員密碼"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  autoFocus
                />
                {authError && <p className="text-sm text-red-500">{authError}</p>}
                <Button className="w-full" onClick={handleLogin} disabled={authLoading || !password}>
                  {authLoading ? '登入中...' : '登入'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Authenticated — show admin panel
  return (
    <div>
      <Header title="管理者頁面" owners={compData?.byOwner?.map(o => o.owner) ?? []} />
      <div className="p-6 space-y-6">
        {/* Logout bar */}
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1 h-3.5 w-3.5" />
            登出
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>表單負責人指派與顯示設定</CardTitle>
              {!editing ? (
                <Button variant="outline" size="sm" onClick={startEdit}>
                  編輯
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                    取消
                  </Button>
                  <Button size="sm" onClick={saveAssignments} disabled={saving}>
                    {saving ? '儲存中...' : '儲存'}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Target ID settings */}
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded border bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
                <span className="text-sm font-medium whitespace-nowrap">基本表單目標：</span>
                {editing ? (
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1 text-sm"
                    placeholder="如 5000"
                    value={draftTargetBasic}
                    onChange={e => setDraftTargetBasic(e.target.value)}
                  />
                ) : (
                  <span className="text-sm font-bold text-blue-600">
                    {ownerData?.targetIds?.basic ? `ID ≤ ${ownerData.targetIds.basic}` : '未設定'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 rounded border bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
                <span className="text-sm font-medium whitespace-nowrap">檢查表單目標：</span>
                {editing ? (
                  <input
                    type="number"
                    className="w-24 rounded border px-2 py-1 text-sm"
                    placeholder="如 3000"
                    value={draftTargetExam}
                    onChange={e => setDraftTargetExam(e.target.value)}
                  />
                ) : (
                  <span className="text-sm font-bold text-blue-600">
                    {ownerData?.targetIds?.exam ? `ID ≤ ${ownerData.targetIds.exam}` : '未設定'}
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {FORMS.map(f => {
                const currentAssignment = editing ? draft[f.name] : (ownerData?.assignments?.[f.name] ?? '');
                const assignedUser = users.find(u => u.username === currentAssignment);
                const displayName = assignedUser?.name || (currentAssignment ? currentAssignment : '未指派');
                const isHidden = editing ? draftHidden.has(f.name) : hiddenForms.has(f.name);

                return (
                  <div key={f.name} className={`flex items-center gap-2 rounded border px-3 py-2 ${isHidden ? 'opacity-40' : ''}`}>
                    {editing ? (
                      <input
                        type="checkbox"
                        checked={!draftHidden.has(f.name)}
                        onChange={() => toggleHidden(f.name)}
                        className="h-4 w-4 shrink-0"
                        title="顯示此表單"
                      />
                    ) : (
                      isHidden && <span className="text-[10px] text-zinc-400 shrink-0">隱藏</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={f.name}>
                      {f.label}
                    </span>
                    {editing ? (
                      <select
                        className="w-28 rounded border px-1.5 py-1 text-xs"
                        value={draft[f.name] || ''}
                        onChange={e => setDraft(prev => ({ ...prev, [f.name]: e.target.value }))}
                      >
                        <option value="">未指派</option>
                        {users.map(u => (
                          <option key={u.username} value={u.username}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded ${currentAssignment ? 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>
                        {displayName}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Labelers management */}
        <Card>
          <CardHeader>
            <CardTitle>Etiology 標記者設定</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="space-y-2">
                {draftLabelers.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-20 rounded border px-2 py-1 text-sm"
                      placeholder="代碼"
                      value={l.code}
                      onChange={e => {
                        const next = [...draftLabelers];
                        next[i] = { ...next[i], code: e.target.value };
                        setDraftLabelers(next);
                      }}
                    />
                    <input
                      type="text"
                      className="w-40 rounded border px-2 py-1 text-sm"
                      placeholder="姓名"
                      value={l.name}
                      onChange={e => {
                        const next = [...draftLabelers];
                        next[i] = { ...next[i], name: e.target.value };
                        setDraftLabelers(next);
                      }}
                    />
                    <button
                      className="text-red-400 hover:text-red-600 text-sm"
                      onClick={() => setDraftLabelers(prev => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setDraftLabelers(prev => [...prev, { code: '', name: '' }])}
                >
                  + 新增標記者
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(ownerData?.labelers ?? []).map(l => (
                  <span key={l.code} className="rounded bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800">
                    {l.name} (code: {l.code})
                  </span>
                ))}
                {(ownerData?.labelers ?? []).length === 0 && (
                  <span className="text-sm text-zinc-400">尚未設定（點擊「編輯」來新增）</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
