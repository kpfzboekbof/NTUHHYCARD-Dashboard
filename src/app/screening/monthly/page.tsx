'use client';

import { useState, useMemo } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import { AdminLoginCard } from '@/components/admin-login-card';
import { ScreeningTabs } from '@/components/screening/screening-tabs';
import { useScreeningData } from '@/hooks/use-screening-data';
import type { ScreeningPatient } from '@/types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function maskName(name: string): string {
  if (!name) return '';
  const chars = [...name];
  if (chars.length <= 1) return name;
  return chars[0] + 'O' + chars.slice(2).join('');
}

function classLabel(cls: string) {
  switch (cls) {
    case 'OHCA': return 'OHCA';
    case 'Prehospital_ROSC': return 'Prehospital ROSC';
    case 'Possible_OHCA': return 'Possible OHCA';
    default: return cls;
  }
}

/** 本月是否要收錄這位病人到月報表 */
function shouldInclude(p: ScreeningPatient): boolean {
  // 被人工排除的一律不收
  if (p.reviewed === 'excluded') return false;
  if (p.ohcaClass === 'OHCA') return true;
  if (p.ohcaClass === 'Prehospital_ROSC') return true;
  // Possible_OHCA：只收已人工確認的
  if (p.ohcaClass === 'Possible_OHCA' && p.reviewed === 'confirmed') return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* 月報表頁                                                            */
/* ------------------------------------------------------------------ */
export default function ScreeningMonthlyPage() {
  const auth = useAdminAuth();
  const { authenticated, handleLogout } = auth;

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, error, isLoading, refresh } = useScreeningData(month);

  // 過濾 + 排序（依日期、院區）
  const rows = useMemo(() => {
    if (!data?.patients) return [];
    const filtered = data.patients.filter(shouldInclude);
    filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.displayGroup !== b.displayGroup) return a.displayGroup.localeCompare(b.displayGroup);
      return (a.chartNo || '').localeCompare(b.chartNo || '');
    });
    return filtered;
  }, [data]);

  // 依院區統計
  const countByGroup = useMemo(() => {
    const c: Record<string, number> = { '總院': 0, '新竹': 0, '雲林': 0 };
    for (const r of rows) c[r.displayGroup] = (c[r.displayGroup] || 0) + 1;
    return c;
  }, [rows]);

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

  return (
    <div>
      <Header title="OHCA 病人擷取" />
      <div className="p-6 space-y-4">
        <ScreeningTabs />

        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            className="rounded border px-3 py-1.5 text-sm"
            value={month}
            onChange={e => e.target.value && setMonth(e.target.value)}
          />

          <div className="flex gap-4 text-xs text-zinc-500">
            <span>總院 <strong className="text-zinc-800 dark:text-zinc-200">{countByGroup['總院']}</strong></span>
            <span>新竹 <strong className="text-zinc-800 dark:text-zinc-200">{countByGroup['新竹']}</strong></span>
            <span>雲林 <strong className="text-zinc-800 dark:text-zinc-200">{countByGroup['雲林']}</strong></span>
            <span>總計 <strong className="text-red-700 dark:text-red-300">{rows.length}</strong></span>
          </div>

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

        {/* 表格 */}
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-400">
                {month} 尚無 OHCA 病人資料
                <div className="mt-1 text-[11px] text-zinc-400">
                  （只列入 OHCA / Prehospital ROSC / 已確認的 Possible OHCA）
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-2 text-left">院區</th>
                      <th className="px-4 py-2 text-left">日期</th>
                      <th className="px-4 py-2 text-left">姓名</th>
                      <th className="px-4 py-2 text-left">年齡</th>
                      <th className="px-4 py-2 text-left">性別</th>
                      <th className="px-4 py-2 text-left">最終動態</th>
                      <th className="px-4 py-2 text-left">分類</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map(p => (
                      <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="px-4 py-2">{p.displayGroup}</td>
                        <td className="px-4 py-2 font-mono text-xs">{p.date}</td>
                        <td className="px-4 py-2">{maskName(p.name)}</td>
                        <td className="px-4 py-2">{p.age}</td>
                        <td className="px-4 py-2">{p.sex}</td>
                        <td className="px-4 py-2">{p.lastStatus || p.disposition || '-'}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-zinc-500">
                            {classLabel(p.ohcaClass)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
