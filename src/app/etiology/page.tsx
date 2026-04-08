'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useEtiologyData } from '@/hooks/use-etiology-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Unlock, Mail, Calendar, AlertTriangle } from 'lucide-react';
import { ETIOLOGY_FINAL_MAP } from '@/lib/redcap/etiology-transform';
import type { ConsensusStatus } from '@/lib/redcap/etiology-transform';

const PAGE_SIZE = 50;

const ETIOLOGY_OPTIONS = Object.entries(ETIOLOGY_FINAL_MAP).map(([code, label]) => ({
  code: parseInt(code),
  label,
}));

type ViewMode = 'tracking' | 'consensus';

/** Row background class based on consensus status (consensus mode only) */
function consensusBgClass(status: ConsensusStatus): string {
  switch (status) {
    case 'yellow': return 'bg-yellow-50 dark:bg-yellow-900/20';
    case 'green': return 'bg-green-50 dark:bg-green-900/20';
    case 'red': return 'bg-red-50 dark:bg-red-900/20';
  }
}

export default function EtiologyPage() {
  const { data, isLoading, refresh } = useEtiologyData();
  const [search, setSearch] = useState('');
  const [idFrom, setIdFrom] = useState('');
  const [idTo, setIdTo] = useState('');
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('tracking');

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

  // Reminder state
  const [meetingDate, setMeetingDate] = useState('');
  const [reminderIdFrom, setReminderIdFrom] = useState('');
  const [reminderIdTo, setReminderIdTo] = useState('');
  const [reminderSentAt, setReminderSentAt] = useState<string | null>(null);
  const [reminderStatus, setReminderStatus] = useState<Array<{
    code: number; name: string; email: string | null; incompleteCount: number;
  }>>([]);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<number | 'all' | false>(false);
  const [sendResult, setSendResult] = useState<Record<number, {
    success: boolean; count: number; error?: string;
  }>>({});

  // Check admin auth on mount
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => {
      if (d.authenticated) setAdminMode(true);
    });
  }, []);

  // Fetch reminder status when admin mode is active
  const fetchReminderStatus = useCallback(async () => {
    setReminderLoading(true);
    try {
      const res = await fetch('/api/etiology-reminder');
      const d = await res.json();
      if (res.ok) {
        setMeetingDate(d.meetingDate || '');
        setReminderIdFrom(d.idFrom != null ? String(d.idFrom) : '');
        setReminderIdTo(d.idTo != null ? String(d.idTo) : '');
        setReminderSentAt(d.reminderSentAt || null);
        setReminderStatus(d.labelerStatus || []);
      }
    } finally {
      setReminderLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminMode) fetchReminderStatus();
  }, [adminMode, fetchReminderStatus]);

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
    setViewMode('tracking');
  }, []);

  const handleSaveSettings = useCallback(async (overrides: { meetingDate?: string; idFrom?: string; idTo?: string }) => {
    const newDate = overrides.meetingDate ?? meetingDate;
    const newFrom = overrides.idFrom ?? reminderIdFrom;
    const newTo = overrides.idTo ?? reminderIdTo;
    if ('meetingDate' in overrides) setMeetingDate(newDate);
    if ('idFrom' in overrides) setReminderIdFrom(newFrom);
    if ('idTo' in overrides) setReminderIdTo(newTo);
    await fetch('/api/etiology-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateSettings',
        meetingDate: newDate || null,
        idFrom: newFrom ? parseInt(newFrom) : null,
        idTo: newTo ? parseInt(newTo) : null,
      }),
    });
    // Refresh labeler counts with new range
    fetchReminderStatus();
  }, [meetingDate, reminderIdFrom, reminderIdTo, fetchReminderStatus]);

  const handleSendReminder = useCallback(async (target: number | 'all') => {
    setSendingReminder(target);
    try {
      // "all" excludes 陳雲昶 by default
      const labelerCodes = target === 'all'
        ? reminderStatus.filter(l => l.name !== '陳雲昶' && l.email && l.incompleteCount > 0).map(l => l.code)
        : [target];

      const res = await fetch('/api/etiology-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendReminder', labelerCodes }),
      });
      const d = await res.json();
      if (res.ok) {
        const resultMap: Record<number, { success: boolean; count: number; error?: string }> = { ...sendResult };
        for (const r of d.results) {
          const labeler = reminderStatus.find(l => l.email === r.email);
          if (labeler) resultMap[labeler.code] = { success: r.success, count: r.count, error: r.error };
        }
        setSendResult(resultMap);
        setReminderSentAt(d.sentAt);
      } else {
        alert(d.error || '發送失敗');
      }
    } catch {
      alert('網路錯誤，請稍後再試');
    } finally {
      setSendingReminder(false);
    }
  }, [reminderStatus, sendResult]);

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

            {/* Reminder card (admin only) */}
            {adminMode && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    共識會議提醒
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Meeting settings */}
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Calendar className="h-4 w-4 text-zinc-500" />
                      共識會議日期
                    </label>
                    <input
                      type="date"
                      className="rounded border px-3 py-1.5 text-sm"
                      value={meetingDate}
                      onChange={e => handleSaveSettings({ meetingDate: e.target.value })}
                    />
                    {meetingDate && (() => {
                      const diff = Math.ceil((new Date(meetingDate).getTime() - Date.now()) / 86400000);
                      if (diff <= 10 && diff >= 0) {
                        return (
                          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            距會議 {diff} 天
                          </span>
                        );
                      }
                      if (diff > 10) {
                        return <span className="text-xs text-zinc-500">距會議 {diff} 天</span>;
                      }
                      return <span className="text-xs text-red-500">會議已過</span>;
                    })()}
                  </div>

                  {/* ID range setting */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium">ID 範圍</span>
                    <input
                      type="number"
                      placeholder="從"
                      className="w-24 rounded border px-2 py-1.5 text-sm"
                      value={reminderIdFrom}
                      onBlur={e => handleSaveSettings({ idFrom: e.target.value })}
                      onChange={e => setReminderIdFrom(e.target.value)}
                    />
                    <span className="text-zinc-400">—</span>
                    <input
                      type="number"
                      placeholder="到"
                      className="w-24 rounded border px-2 py-1.5 text-sm"
                      value={reminderIdTo}
                      onBlur={e => handleSaveSettings({ idTo: e.target.value })}
                      onChange={e => setReminderIdTo(e.target.value)}
                    />
                    {(reminderIdFrom || reminderIdTo) && (
                      <span className="text-xs text-zinc-500">
                        僅統計此範圍內的未完成筆數
                      </span>
                    )}
                  </div>

                  {/* Labeler incomplete summary with individual send buttons */}
                  {!reminderLoading && reminderStatus.length > 0 && (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-zinc-500">
                            <th className="px-3 py-2">Labeler</th>
                            <th className="px-3 py-2 text-center">未完成數</th>
                            <th className="px-3 py-2 text-center">發送提醒</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reminderStatus.map(l => {
                            const result = sendResult[l.code];
                            const isSending = sendingReminder === l.code || sendingReminder === 'all';
                            const canSend = !!l.email && l.incompleteCount > 0 && !!meetingDate;
                            return (
                              <tr key={l.code} className="border-b">
                                <td className="px-3 py-1.5">{l.name}</td>
                                <td className="px-3 py-1.5 text-center">
                                  {l.incompleteCount > 0 ? (
                                    <span className="font-medium text-amber-600">{l.incompleteCount}</span>
                                  ) : (
                                    <span className="text-green-600">0</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  {result ? (
                                    result.success ? (
                                      <span className="text-xs text-green-600">已發送（{result.count} 筆）</span>
                                    ) : (
                                      <span className="text-xs text-red-500">失敗：{result.error}</span>
                                    )
                                  ) : !l.email ? (
                                    <span className="text-xs text-zinc-400">未設定 Email</span>
                                  ) : (
                                    <button
                                      className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/30 dark:text-blue-400"
                                      disabled={!canSend || !!sendingReminder}
                                      onClick={() => handleSendReminder(l.code)}
                                    >
                                      {isSending ? '發送中...' : '發送'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Send all + status */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => handleSendReminder('all')}
                      disabled={!!sendingReminder || !meetingDate || reminderStatus.every(l => !l.email || l.incompleteCount === 0)}
                      size="sm"
                    >
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      {sendingReminder === 'all' ? '發送中...' : '群發提醒（不含陳雲昶）'}
                    </Button>
                    {reminderSentAt && (
                      <span className="text-xs text-zinc-500">
                        上次發送：{new Date(reminderSentAt).toLocaleString('zh-TW')}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Records table */}
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

                {/* View mode tabs (consensus requires admin) */}
                {adminMode && (
                  <div className="mt-3 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
                    <button
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        viewMode === 'tracking'
                          ? 'bg-white shadow text-zinc-900 dark:bg-zinc-700 dark:text-white'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                      onClick={() => setViewMode('tracking')}
                    >
                      追蹤
                    </button>
                    <button
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        viewMode === 'consensus'
                          ? 'bg-white shadow text-zinc-900 dark:bg-zinc-700 dark:text-white'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                      onClick={() => setViewMode('consensus')}
                    >
                      共識會議
                    </button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {/* Legend for consensus mode */}
                {viewMode === 'consensus' && (
                  <div className="mb-3 flex flex-wrap gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded bg-green-200 dark:bg-green-800" /> 已達共識（3:0, 4:0, 5:0, 3:1, 4:1）
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded bg-red-200 dark:bg-red-800" /> 需要共識討論
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded bg-yellow-200 dark:bg-yellow-800" /> 票數不足（&lt;3），無法進入共識
                    </span>
                  </div>
                )}

                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-zinc-500">
                        <th className="px-3 py-2 sticky left-0 bg-white dark:bg-zinc-950 z-10">Study ID</th>
                        {labelers.map(l => (
                          <th key={l.code} className="px-2 py-2 text-center whitespace-nowrap">{l.name}</th>
                        ))}
                        {viewMode === 'consensus' && (
                          <th className="px-2 py-2 text-center whitespace-nowrap text-zinc-400">票數</th>
                        )}
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
                        const isConsensus = viewMode === 'consensus';
                        const isYellow = r.consensusStatus === 'yellow';
                        const dropdownDisabled = isSaving || (isConsensus && isYellow);

                        // Row background
                        const rowBg = isVisited
                          ? 'bg-amber-100 dark:bg-amber-900/40'
                          : isConsensus
                            ? consensusBgClass(r.consensusStatus)
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800';

                        // Sticky cell background (must match row)
                        const stickyBg = isVisited
                          ? 'bg-amber-100 dark:bg-amber-900/40'
                          : isConsensus
                            ? consensusBgClass(r.consensusStatus)
                            : 'bg-white dark:bg-zinc-950';

                        return (
                          <tr key={r.studyId} className={`border-b transition-colors ${rowBg}`}>
                            <td
                              className={`px-3 py-1.5 font-mono text-xs sticky left-0 z-10 cursor-pointer hover:underline text-blue-600 ${stickyBg}`}
                              onClick={() => {
                                setLastVisited(r.studyId);
                                window.open(`https://redcap.ntuh.gov.tw/redcap_v16.1.9/DataEntry/index.php?pid=8207&id=${r.studyId}&page=ntuh_nhi_etiology`, '_blank');
                              }}
                            >{r.studyId}</td>

                            {/* Reviewer columns */}
                            {r.reviewers.map(rev => (
                              <td key={rev.labelerCode} className="px-2 py-1.5 text-center">
                                {isConsensus ? (
                                  // Consensus mode: show cause code
                                  rev.causeCode !== null ? (
                                    <span className="font-mono text-xs font-medium">{rev.causeCode}</span>
                                  ) : (
                                    <span className="text-zinc-300">—</span>
                                  )
                                ) : (
                                  // Tracking mode: checkmark or dash
                                  rev.complete ? (
                                    <span className="text-green-600 font-bold">✓</span>
                                  ) : (
                                    <span className="text-zinc-300">—</span>
                                  )
                                )}
                              </td>
                            ))}

                            {/* Vote count column (consensus only) */}
                            {isConsensus && (
                              <td className="px-2 py-1.5 text-center text-xs text-zinc-500">
                                {r.completedCount}
                              </td>
                            )}

                            {/* etiology_final dropdown */}
                            <td className="px-3 py-1.5 text-center">
                              {adminMode && !dropdownDisabled ? (
                                <select
                                  disabled={isSaving}
                                  className="rounded border px-1.5 py-0.5 text-xs w-48 disabled:opacity-50"
                                  defaultValue=""
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === '') return;
                                    handleSetFinal(r.studyId, parseInt(val));
                                    e.target.value = '';
                                  }}
                                >
                                  <option value="">— 選擇 —</option>
                                  {ETIOLOGY_OPTIONS.map(o => (
                                    <option key={o.code} value={o.code}>{o.label}</option>
                                  ))}
                                </select>
                              ) : isConsensus && isYellow ? (
                                <span className="text-[10px] text-zinc-400">需 ≥3 完成</span>
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
                          <td colSpan={2 + labelers.length + (viewMode === 'consensus' ? 1 : 0)} className="px-3 py-8 text-center text-zinc-400">
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
                        className="rounded border px-3 py-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:active:bg-transparent dark:hover:bg-zinc-800 dark:active:bg-zinc-700 dark:disabled:hover:bg-transparent dark:disabled:active:bg-transparent"
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                      >
                        上一頁
                      </button>
                      <button
                        className="rounded border px-3 py-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:active:bg-transparent dark:hover:bg-zinc-800 dark:active:bg-zinc-700 dark:disabled:hover:bg-transparent dark:disabled:active:bg-transparent"
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
