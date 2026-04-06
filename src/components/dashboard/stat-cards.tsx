'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Database, ShieldCheck, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import type { CompletionRow } from '@/types';

interface StatCardsProps {
  rows: CompletionRow[];
}

export function StatCards({ rows }: StatCardsProps) {
  const totalRecords = new Set(rows.map(r => r.studyId)).size;
  const validRows = rows.filter(r => !r.excluded);
  const validOhcaCount = new Set(validRows.map(r => r.studyId)).size;
  const completePct = validRows.length > 0
    ? Math.round(validRows.filter(r => r.statusCode === 2).length / validRows.length * 1000) / 10
    : 0;
  const unverifiedCount = validRows.filter(r => r.statusCode === 1).length;
  const incompleteCount = validRows.filter(r => r.statusCode === 0).length;

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
