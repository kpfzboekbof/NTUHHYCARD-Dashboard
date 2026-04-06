'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useEtiologyData } from '@/hooks/use-etiology-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Unlock } from 'lucide-react';
import { ETIOLOGY_FINAL_MAP } from '@/lib/redcap/etiology-transform';

const PAGE_SIZE = 50;

const ETIOLOGY_OPTIONS = Object.entries(ETIOLOGY_FINAL_MAP).map(([code, label]) => ({
  code: parseInt(code),
  label,
}));

export default function EtiologyPage() {
  const { data, isLoading, refresh } = useEtiologyData();
  const [search, setSearch] = useState('');
  const [idFrom, setIdFrom] = useState('');
  const [idTo, setIdTo] = useState('');
  const [page, setPage] = useState(0);

  // Admin state
  const [adminMode, setAdminMode] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Last visited (highlight)
  const [lastVisited, setLastVisited] = useState<string | null>(null);

  // Per-row save state: studyId → 'saving' | 'error'
  const [rowState, setRowState] = useState<Record<string, 'saving' | 'error'>>({});

  // Check admin auth on mount
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) setAdminMode(true);
    });
  }, []);

  useEffect(() => {
    if (showLoginModal) {
      setTimeout(() => passwordInputRef.current?.focus(), 50);
    }
  }, [showLoginModal]);

  const handleLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await res.json();
      if (res.ok) {
        setAdminMode(true);
        setShowLoginModal(false);
        setPassword('');
      } else {
        setAuthError(d.error || '密碼錯誤');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setAdminMode(false);
  }, []);

  // Write etiology_final for a record
  const handleSetFinal = useCallback(async (studyId: string, code: number) => {
    setRowState(prev => ({ ...prev, [studyId]: 'saving' }));
    try {
      const res = await fetch('/api/etiology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyId, code }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || '儲存失敗');
        setRowState(prev => ({ ...prev, [studyId]: 'error' }));
        return;
      }
      // Success — refresh data (the record will disappear from incomplete list)
      refresh();
      setRowState(prev => {
        const next = { ...prev };
        delete next[studyId];
        return next;
      });
    } catch {
      alert('網路錯誤，請稍後再試');
      setRowState(prev => ({ ...prev, [studyId]: 'error' }));
    }
  }, [refresh]);

  const labelers = data?.labelers ?? [];

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

                  {/* Admin toggle */}
                  {adminMode ? (
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300"
                    >
                      <Unlock className="h-3 w-3" />
                      管理員模式
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowLoginModal(true)}
                      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <Lock className="h-3 w-3" />
                      管理員模式
                    </button>
                  )}

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
                        {labelers.map(l => (
                          <th key={l.code} className="px-2 py-2 text-center whitespace-nowrap">{l.name}</th>
                        ))}
                        <th className="px-3 py-2 text-center whitespace-nowrap">
                          etiology_final
                          {!adminMode && (
                            <span className="ml-1 text-[10px] text-zinc-400">(需管理員)</span>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(r => {
                        const isSaving = rowState[r.studyId] === 'saving';
                        const isVisited = lastVisited === r.studyId;
                        return (
                          <tr key={r.studyId} className={`border-b transition-colors ${isVisited ? 'bg-amber-100 dark:bg-amber-900/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
                            <td
                              className={`px-3 py-1.5 font-mono text-xs sticky left-0 cursor-pointer hover:underline text-blue-600 ${isVisited ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-white dark:bg-zinc-950'}`}
                              onClick={() => {
                                setLastVisited(r.studyId);
                                window.open(`https://redcap.ntuh.gov.tw/redcap_v16.1.9/DataEntry/index.php?pid=8207&id=${r.studyId}&page=ntuh_nhi_etiology`, '_blank');
                              }}
                            >{r.studyId}</td>
                            {r.reviewers.map(rev => (
                              <td key={rev.labelerCode} className="px-2 py-1.5 text-center">
                                {rev.complete ? (
                                  <span className="text-green-600 font-bold">✓</span>
                                ) : (
                                  <span className="text-zinc-300">—</span>
                                )}
                              </td>
                            ))}
                            <td className="px-3 py-1.5 text-center">
                              {adminMode ? (
                                <select
                                  disabled={isSaving}
                                  className="rounded border px-1.5 py-0.5 text-xs w-48 disabled:opacity-50"
                                  defaultValue=""
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === '') return;
                                    handleSetFinal(r.studyId, parseInt(val));
                                    e.target.value = ''; // reset after submit
                                  }}
                                >
                                  <option value="">— 選擇 —</option>
                                  {ETIOLOGY_OPTIONS.map(o => (
                                    <option key={o.code} value={o.code}>{o.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-zinc-300 text-xs">—</span>
                              )}
                              {isSaving && (
                                <span className="ml-1 text-xs text-zinc-400">儲存中...</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {pageRows.length === 0 && (
                        <tr>
                          <td colSpan={2 + labelers.length} className="px-3 py-8 text-center text-zinc-400">
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

      {/* Admin login modal */}
      {showLoginModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) { setShowLoginModal(false); setAuthError(''); setPassword(''); } }}
        >
          <div className="w-72 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <Lock className="h-4 w-4" />
              管理員登入
            </h3>
            <div className="space-y-3">
              <input
                ref={passwordInputRef}
                type="password"
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="請輸入管理員密碼"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
              {authError && <p className="text-xs text-red-500">{authError}</p>}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => { setShowLoginModal(false); setAuthError(''); setPassword(''); }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleLogin}
                  disabled={authLoading || !password}
                >
                  {authLoading ? '登入中...' : '登入'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
