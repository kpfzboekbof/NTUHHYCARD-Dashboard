'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Lock, LogOut, Loader2, Check, X, AlertTriangle, Heart } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useScreeningData } from '@/hooks/use-screening-data';
import type { ScreeningPatient } from '@/types';

/* ------------------------------------------------------------------ */
/* 工具：姓名屏蔽（第二字變 O）                                         */
/* ------------------------------------------------------------------ */
function maskName(name: string): string {
  if (!name) return '';
  const chars = [...name];
  if (chars.length <= 1) return name;
  return chars[0] + 'O' + chars.slice(2).join('');
}

/* ------------------------------------------------------------------ */
/* 分類顏色與標籤                                                      */
/* ------------------------------------------------------------------ */
function classColor(cls: string) {
  switch (cls) {
    case 'OHCA': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'Prehospital_ROSC': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 'Possible_OHCA': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    default: return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
  }
}

function classLabel(cls: string) {
  switch (cls) {
    case 'OHCA': return 'OHCA';
    case 'Prehospital_ROSC': return 'Prehospital ROSC';
    case 'Possible_OHCA': return 'Possible OHCA';
    default: return cls;
  }
}

/* ------------------------------------------------------------------ */
/* 主頁面                                                              */
/* ------------------------------------------------------------------ */
const DISPLAY_GROUPS = ['總院', '新竹', '雲林'] as const;

export default function ScreeningPage() {
  // Auth state
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Month selector
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Data
  const { data, error, isLoading, refresh } = useScreeningData(month);

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
      const d = await res.json();
      if (res.ok) { setAuthenticated(true); setPassword(''); }
      else { setAuthError(d.error || '登入失敗'); }
    } finally { setAuthLoading(false); }
  }, [password]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setAuthenticated(false);
  }, []);

  const handleReview = useCallback(async (patientId: string, decision: 'confirmed' | 'excluded') => {
    await fetch('/api/screening/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patientId, decision, month }),
    });
    refresh();
  }, [month, refresh]);

  // 過濾 OHCA 相關病人
  const ohcaPatients = useMemo(() => {
    if (!data?.patients) return [];
    return data.patients.filter(p =>
      p.ohcaClass === 'OHCA' ||
      p.ohcaClass === 'Prehospital_ROSC' ||
      p.ohcaClass === 'Possible_OHCA'
    );
  }, [data]);

  // 按院區分組
  const byGroup = useMemo(() => {
    const groups: Record<string, ScreeningPatient[]> = {};
    for (const g of DISPLAY_GROUPS) groups[g] = [];
    for (const p of ohcaPatients) {
      const g = p.displayGroup || '新竹';
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return groups;
  }, [ohcaPatients]);

  // 月份選項
  const monthOptions = useMemo(() => {
    const months = data?.availableMonths || [];
    if (!months.includes(month)) months.push(month);
    return [...new Set(months)].sort().reverse();
  }, [data, month]);

  // ---------- Auth loading ----------
  if (authenticated === null) {
    return (
      <div>
        <Header title="OHCA 病人擷取" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-zinc-400">驗證中...</div>
        </div>
      </div>
    );
  }

  // ---------- Login screen ----------
  if (!authenticated) {
    return (
      <div>
        <Header title="OHCA 病人擷取" />
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

  // ---------- Authenticated ----------
  return (
    <div>
      <Header title="OHCA 病人擷取" />
      <div className="p-6 space-y-6">

        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded border px-3 py-1.5 text-sm"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <p className="text-xs text-zinc-400">
            院內電腦每日 09:00 自動掃描上傳
          </p>

          {/* 已掃描日期 badges */}
          {data?.dates && data.dates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-zinc-500">已掃描:</span>
              {data.dates.map(d => {
                // d 格式: 2026-04-09 → 顯示 4/9
                const parts = d.split('-');
                const short = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : d;
                return (
                  <span
                    key={d}
                    title={d}
                    className="inline-flex items-center rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
                  >
                    <Check className="mr-0.5 h-2.5 w-2.5" />
                    {short}
                  </span>
                );
              })}
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            {data?.fetchedAt && (
              <span className="text-xs text-zinc-400">
                更新: {new Date(data.fetchedAt).toLocaleString('zh-TW')}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              重新整理
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-1 h-3.5 w-3.5" />
              登出
            </Button>
          </div>
        </div>

        {/* Error / Loading */}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            載入失敗: {error.message}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入中...
          </div>
        )}

        {/* Summary stats */}
        {data && (
          <div className="flex gap-4">
            <div className="rounded-lg border bg-red-50 px-4 py-2 text-center dark:bg-red-950">
              <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                {ohcaPatients.filter(p => p.ohcaClass === 'OHCA').length}
              </div>
              <div className="text-xs text-red-600 dark:text-red-400">OHCA</div>
            </div>
            <div className="rounded-lg border bg-orange-50 px-4 py-2 text-center dark:bg-orange-950">
              <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                {ohcaPatients.filter(p => p.ohcaClass === 'Prehospital_ROSC').length}
              </div>
              <div className="text-xs text-orange-600 dark:text-orange-400">Prehospital ROSC</div>
            </div>
            <div className="rounded-lg border bg-yellow-50 px-4 py-2 text-center dark:bg-yellow-950">
              <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                {ohcaPatients.filter(p => p.ohcaClass === 'Possible_OHCA').length}
              </div>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">Possible OHCA</div>
            </div>
            <div className="rounded-lg border bg-zinc-50 px-4 py-2 text-center dark:bg-zinc-900">
              <div className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">
                {data.dates.length}
              </div>
              <div className="text-xs text-zinc-500">已掃描天數</div>
            </div>
          </div>
        )}

        {/* Three-column hospital layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {DISPLAY_GROUPS.map(group => (
            <Card key={group}>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-500" />
                  {group}
                  <span className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {byGroup[group]?.length || 0} 人
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(!byGroup[group] || byGroup[group].length === 0) ? (
                  <div className="p-6 text-center text-sm text-zinc-400">
                    本月無 OHCA 病人
                  </div>
                ) : (
                  <div className="divide-y">
                    {byGroup[group].map(patient => (
                      <PatientRow
                        key={patient.id}
                        patient={patient}
                        onReview={handleReview}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 病人列                                                              */
/* ------------------------------------------------------------------ */
interface PatientRowProps {
  patient: ScreeningPatient;
  onReview: (id: string, decision: 'confirmed' | 'excluded') => void;
}

function PatientRow({ patient, onReview }: PatientRowProps) {
  const [expanded, setExpanded] = useState(false);

  const isPossible = patient.ohcaClass === 'Possible_OHCA';
  const isReviewed = patient.reviewed !== null && patient.reviewed !== undefined;
  const isConfirmed = patient.reviewed === 'confirmed';
  const isExcluded = patient.reviewed === 'excluded';

  return (
    <div className="px-4 py-3">
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{patient.chartNo}</span>
            <span className="text-sm">{maskName(patient.name)}</span>
            <span className="text-xs text-zinc-400">{patient.sex}</span>
            <span className="text-xs text-zinc-400">{patient.age}</span>
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {patient.regDate} · {patient.disposition}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classColor(patient.ohcaClass)}`}>
            {classLabel(patient.ohcaClass)}
          </span>

          {isPossible && isConfirmed && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              <Check className="h-3 w-3" /> 已確認
            </span>
          )}
          {isPossible && isExcluded && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              <X className="h-3 w-3" /> 已排除
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 rounded border bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
          <div><strong>主診斷:</strong> {patient.diagnosis || 'N/A'}</div>
          {patient.statOrders && <div><strong>STAT 醫囑:</strong> {patient.statOrders}</div>}
          {patient.chiefComplaint && <div><strong>主訴:</strong> {patient.chiefComplaint}</div>}
          {patient.presentIllness && (
            <div><strong>現病史:</strong> {patient.presentIllness.slice(0, 200)}</div>
          )}
          {patient.vitalSigns && (
            <div>
              <strong>Vital Signs:</strong>{' '}
              BP {patient.vitalSigns.blood_pressure || 'N/A'},{' '}
              HR {patient.vitalSigns.heart_rate || 'N/A'},{' '}
              SpO2 {patient.vitalSigns.spo2 || 'N/A'}
            </div>
          )}

          {isPossible && !isReviewed && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-700 dark:text-yellow-300 font-medium">需要人工判定:</span>
              <Button
                size="xs"
                onClick={(e) => { e.stopPropagation(); onReview(patient.id, 'confirmed'); }}
              >
                <Check className="mr-1 h-3 w-3" /> 確認 OHCA
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => { e.stopPropagation(); onReview(patient.id, 'excluded'); }}
              >
                <X className="mr-1 h-3 w-3" /> 排除
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
