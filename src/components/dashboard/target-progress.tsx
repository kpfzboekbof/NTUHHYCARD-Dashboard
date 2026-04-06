'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FORMS, EXAM_FORMS } from '@/config/forms';
import type { CompletionRow } from '@/types';

interface TargetProgressProps {
  rows: CompletionRow[];
  targetIds: { basic: number | null; exam: number | null };
  hiddenForms?: string[];
  ownerFilter?: string;
}

function calcFormStats(rows: CompletionRow[], targetId: number, formNames: string[], hiddenForms: string[]) {
  const targetRows = rows.filter(r =>
    !r.excluded &&
    parseInt(r.studyId) <= targetId &&
    formNames.includes(r.form) &&
    !hiddenForms.includes(r.form)
  );

  const visibleForms = FORMS.filter(f => formNames.includes(f.name) && !hiddenForms.includes(f.name));

  const byForm = new Map<string, { total: number; complete: number; incomplete: number }>();
  for (const r of targetRows) {
    let s = byForm.get(r.form);
    if (!s) s = { total: 0, complete: 0, incomplete: 0 };
    s.total++;
    if (r.statusCode === 2) s.complete++;
    else s.incomplete++;
    byForm.set(r.form, s);
  }

  return visibleForms.map(f => {
    const s = byForm.get(f.name) ?? { total: 0, complete: 0, incomplete: 0 };
    return {
      form: f.name,
      label: f.label,
      total: s.total,
      complete: s.complete,
      incomplete: s.incomplete,
      allDone: s.total > 0 && s.incomplete === 0,
    };
  });
}

function TargetSection({ title, targetId, formStats }: {
  title: string;
  targetId: number;
  formStats: { form: string; label: string; incomplete: number; allDone: boolean }[];
}) {
  const allComplete = formStats.every(f => f.allDone);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {title}：ID ≤ {targetId}
          {allComplete ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">全部完成 ✓</span>
          ) : (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">進行中</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {formStats.map(f => (
            <Link
              key={f.form}
              href={`/incomplete?form=${f.form}`}
              className={`flex items-center justify-between rounded border px-3 py-2 text-sm transition-shadow hover:shadow-md ${
                f.allDone
                  ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
                  : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
              }`}
            >
              <span className="font-medium">{f.label}</span>
              {f.allDone ? (
                <span className="text-green-600 font-bold text-xs">✓ 完成</span>
              ) : (
                <span className="text-red-600 font-bold text-xs">缺 {f.incomplete} 筆</span>
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TargetProgress({ rows, targetIds, hiddenForms = [], ownerFilter }: TargetProgressProps) {
  const basicFormNames = FORMS.map(f => f.name).filter(n => !EXAM_FORMS.includes(n));

  // When a specific owner is selected, only show their assigned forms
  const ownerForms = useMemo(() => {
    if (!ownerFilter || ownerFilter === '全部') return null;
    return new Set(rows.filter(r => r.owner === ownerFilter).map(r => r.form));
  }, [rows, ownerFilter]);

  const basicStats = useMemo(() => {
    if (!targetIds.basic) return null;
    const names = ownerForms ? basicFormNames.filter(n => ownerForms.has(n)) : basicFormNames;
    if (names.length === 0) return null;
    return calcFormStats(rows, targetIds.basic, names, hiddenForms);
  }, [rows, targetIds.basic, hiddenForms, ownerForms]);

  const examStats = useMemo(() => {
    if (!targetIds.exam) return null;
    const names = ownerForms ? EXAM_FORMS.filter(n => ownerForms.has(n)) : EXAM_FORMS;
    if (names.length === 0) return null;
    return calcFormStats(rows, targetIds.exam, names, hiddenForms);
  }, [rows, targetIds.exam, hiddenForms, ownerForms]);

  if (!basicStats && !examStats) return null;

  return (
    <div className="space-y-4">
      {basicStats && targetIds.basic && (
        <TargetSection title="基本表單目標" targetId={targetIds.basic} formStats={basicStats} />
      )}
      {examStats && targetIds.exam && (
        <TargetSection title="檢查表單目標" targetId={targetIds.exam} formStats={examStats} />
      )}
    </div>
  );
}
