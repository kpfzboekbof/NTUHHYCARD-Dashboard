'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  LogOut, Loader2, Check, X, AlertTriangle, Heart,
  ChevronLeft, ChevronRight, Clock,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import { AdminLoginCard } from '@/components/admin-login-card';
import { ScreeningTabs } from '@/components/screening/screening-tabs';
import { useScreeningData } from '@/hooks/use-screening-data';
import type { ScreeningPatient, ScanInfo } from '@/types';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function maskName(name: string): string {
  if (!name) return '';
  const chars = [...name];
  if (chars.length <= 1) return name;
  return chars[0] + 'O' + chars.slice(2).join('');
}

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

/** 取得 YYYY-MM-DD 格式的今日日期（local time） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → YYYY-MM */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 將 YYYY-MM-DD 加上 n 天（n 可負） */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 判斷某日的掃描是否「完整」：scannedAt > 該日 23:59:59 */
type ScanStatus = 'complete' | 'partial' | 'missing';
function scanStatus(selectedDate: string, info: ScanInfo | undefined): ScanStatus {
  if (!info) return 'missing';
  if (!info.scannedAt) return 'partial'; // 有檔案但沒 timestamp → 視為進行中
  // 當日結束時間 (local): selectedDate 23:59:59.999
  const [y, m, d] = selectedDate.split('-').map(Number);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  const scanned = new Date(info.scannedAt);
  return scanned > endOfDay ? 'complete' : 'partial';
}

/* ------------------------------------------------------------------ */
/* 主頁面（每日檢視）                                                  */
/* ------------------------------------------------------------------ */
const DISPLAY_GROUPS = ['總院', '新竹', '雲林'] as const;
type DisplayGroup = typeof DISPLAY_GROUPS[number];

export default function ScreeningDailyPage() {
  // Auth
  const auth = useAdminAuth();
  const { authenticated, handleLogout } = auth;

  // 選擇的日期（YYYY-MM-DD），預設今天
  const [selectedDate, setSelectedDate] = useState<string>(() => todayStr());
  const month = monthOf(selectedDate);

  const { data, error, isLoading, refresh } = useScreeningData(month);

  const handleReview = useCallback(async (patientId: string, decision: 'confirmed' | 'excluded') => {
    await fetch('/api/screening/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: patientId, decision, month }),
    });
    refresh();
  }, [month, refresh]);

  // 該日所有病人（含 Not_OHCA）及 OHCA 相關病人
  const { patientsByGroup, totalByGroup } = useMemo(() => {
    const groups: Record<DisplayGroup, ScreeningPatient[]> = {
      '總院': [], '新竹': [], '雲林': [],
    };
    const totals: Record<DisplayGroup, { all: number }> = {
      '總院': { all: 0 },
      '新竹': { all: 0 },
      '雲林': { all: 0 },
    };
    if (!data?.patients) return { patientsByGroup: groups, totalByGroup: totals };
    for (const p of data.patients) {
      if (p.date !== selectedDate) continue;
      const g = (p.displayGroup || '新竹') as DisplayGroup;
      if (!totals[g]) continue;
      totals[g].all++;
      if (p.ohcaClass !== 'OHCA' && p.ohcaClass !== 'Prehospital_ROSC' && p.ohcaClass !== 'Possible_OHCA') continue;
      if (groups[g]) groups[g].push(p);
    }
    return { patientsByGroup: groups, totalByGroup: totals };
  }, [data, selectedDate]);

  // 每院區該日的掃描狀態
  const scanStatusByGroup = useMemo(() => {
    const result: Record<DisplayGroup, { status: ScanStatus; info?: ScanInfo }> = {
      '總院': { status: 'missing' },
      '新竹': { status: 'missing' },
      '雲林': { status: 'missing' },
    };
    if (!data?.scannedByGroup) return result;
    for (const g of DISPLAY_GROUPS) {
      const info = data.scannedByGroup[g]?.find(s => s.date === selectedDate);
      result[g] = { status: scanStatus(selectedDate, info), info };
    }
    return result;
  }, [data, selectedDate]);

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
          <AdminLoginCard auth={auth} />
        </div>
      </div>
    );
  }

  const isToday = selectedDate === todayStr();

  // ---------- Main view ----------
  return (
    <div>
      <Header title="OHCA 病人擷取" />
      <div className="p-6 space-y-4">
        <ScreeningTabs />

        {/* Top bar: date picker + actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            className="rounded border px-3 py-1.5 text-sm"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            max={todayStr()}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            disabled={isToday}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => setSelectedDate(todayStr())}>
              回到今天
            </Button>
          )}

          <p className="text-xs text-zinc-400">
            院內電腦每日 09:00 自動掃描前一天
          </p>

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

        {/* Three hospital cards for the selected day */}
        <div className="grid gap-6 lg:grid-cols-3">
          {DISPLAY_GROUPS.map(group => {
            const list = patientsByGroup[group];
            const totals = totalByGroup[group];
            const { status, info } = scanStatusByGroup[group];
            return (
              <Card key={group}>
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-red-500" />
                    {group}
                    <span className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {list.length} 人
                    </span>
                  </CardTitle>
                  {/* 掃描統計 + 狀態 */}
                  <div className="mt-2 flex items-center gap-3">
                    <ScanStatusBadge status={status} info={info} />
                    {status !== 'missing' && (
                      <span className="text-xs text-zinc-400">
                        {info?.totalEd != null && <>急診 {info.totalEd} 人 · </>}
                        1 級 {totals.all} 人
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {status === 'missing' ? (
                    <div className="p-6 text-center text-sm text-zinc-400">
                      本日尚未掃描
                    </div>
                  ) : list.length === 0 ? (
                    <div className="p-6 text-center text-sm text-zinc-400">
                      本日無 OHCA 病人
                    </div>
                  ) : (
                    <div className="divide-y">
                      {list.map(patient => (
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 掃描狀態 badge                                                      */
/* ------------------------------------------------------------------ */
function ScanStatusBadge({ status, info }: { status: ScanStatus; info?: ScanInfo }) {
  if (status === 'complete') {
    return (
      <span
        title={info?.scannedAt ? `完成時間: ${new Date(info.scannedAt).toLocaleString('zh-TW')}` : undefined}
        className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200"
      >
        <Check className="h-3 w-3" />
        完整掃描
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span
        title={info?.scannedAt ? `掃描時間: ${new Date(info.scannedAt).toLocaleString('zh-TW')}（當日尚未結束）` : '當日掃描進行中'}
        className="inline-flex items-center gap-1 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
      >
        <Clock className="h-3 w-3" />
        掃描中（當日尚未結束）
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <X className="h-3 w-3" />
      尚未掃描
    </span>
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
  const isOhcaLike = ['OHCA', 'Prehospital_ROSC'].includes(patient.ohcaClass);
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
            {patient.regDate} · {patient.lastStatus || patient.disposition}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classColor(patient.ohcaClass)}`}>
            {classLabel(patient.ohcaClass)}
          </span>

          {isConfirmed && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              <Check className="h-3 w-3" /> 已確認
            </span>
          )}
          {isExcluded && (
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

          {!isExcluded && !isPossible && patient.ohcaClass !== 'Not_OHCA' && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => { e.stopPropagation(); onReview(patient.id, 'excluded'); }}
              >
                <X className="mr-1 h-3 w-3" /> 非 OHCA（覆寫）
              </Button>
            </div>
          )}

          {isExcluded && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => { e.stopPropagation(); onReview(patient.id, 'confirmed'); }}
              >
                <Check className="mr-1 h-3 w-3" /> 恢復 OHCA
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
