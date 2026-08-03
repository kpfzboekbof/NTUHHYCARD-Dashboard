'use client';

import { memo, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Database, ShieldCheck, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import type { CompletionRow } from '@/types';

interface StatCardsProps {
  rows: CompletionRow[];
}

function StatCardsImpl({ rows }: StatCardsProps) {
  // One pass instead of six full traversals (two Sets, one filter, three more
  // filters over the filtered copy) on every render of a ~60k-row array.
  const {
    totalRecords, validOhcaCount, completePct, unverifiedCount, incompleteCount,
  } = useMemo(() => {
    const allIds = new Set<string>();
    const validIds = new Set<string>();
    let validCount = 0, complete = 0, unverified = 0, incomplete = 0;

    for (const r of rows) {
      // Added before the exclusion check — totalRecords is a pre-exclusion count.
      allIds.add(r.studyId);
      if (r.excluded) continue;
      validIds.add(r.studyId);
      validCount++;
      if (r.statusCode === 2) complete++;
      else if (r.statusCode === 1) unverified++;
      else incomplete++;
    }

    return {
      totalRecords: allIds.size,
      validOhcaCount: validIds.size,
      completePct: validCount > 0 ? Math.round(complete / validCount * 1000) / 10 : 0,
      unverifiedCount: unverified,
      incompleteCount: incomplete,
    };
  }, [rows]);

  const cards = [
    { label: '總記錄數', value: totalRecords.toLocaleString(), icon: Database, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '有效 OHCA', value: validOhcaCount.toLocaleString(), icon: ShieldCheck, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Complete 比例', value: `${completePct}%`, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Unverified', value: unverifiedCount.toLocaleString(), icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Incomplete', value: incompleteCount.toLocaleString(), icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map(c => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`rounded-lg p-2.5 ${c.bg}`}>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-sm text-zinc-500">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export const StatCards = memo(StatCardsImpl);
