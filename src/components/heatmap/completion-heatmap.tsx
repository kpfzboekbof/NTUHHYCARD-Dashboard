'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FORMS } from '@/config/forms';
import type { CompletionRow } from '@/types';

const STATUS_COLORS: Record<number, string> = {
  0: 'bg-red-400',
  1: 'bg-yellow-400',
  2: 'bg-green-400',
};

const STATUS_LABELS: Record<number, string> = {
  0: 'Incomplete',
  1: 'Unverified',
  2: 'Complete',
};

interface CompletionHeatmapProps {
  rows: CompletionRow[];
}

export function CompletionHeatmap({ rows }: CompletionHeatmapProps) {
  const [limit, setLimit] = useState(200);

  const { studyIds, matrix } = useMemo(() => {
    // Get unique study IDs, sorted descending, limited
    const allIds = [...new Set(rows.map(r => r.studyId))].sort().reverse().slice(0, limit);

    // Build a lookup: studyId -> form -> statusCode
    const lookup = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!allIds.includes(row.studyId)) continue;
      if (!lookup.has(row.studyId)) lookup.set(row.studyId, new Map());
      lookup.get(row.studyId)!.set(row.form, row.statusCode);
    }

    return { studyIds: allIds, matrix: lookup };
  }, [rows, limit]);

  const formLabels = FORMS.map(f => f.label);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Record x Form 完成狀態熱力圖</CardTitle>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-block h-3 w-3 rounded bg-green-400" /> Complete
              <span className="ml-2 inline-block h-3 w-3 rounded bg-yellow-400" /> Unverified
              <span className="ml-2 inline-block h-3 w-3 rounded bg-red-400" /> Incomplete
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label>顯示筆數:</label>
              <input
                type="range"
                min={50} max={500} step={50}
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className="w-32"
              />
              <span className="w-8 text-right">{limit}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-950">
              <tr>
                <th className="sticky left-0 z-20 bg-white dark:bg-zinc-950 px-2 py-1 text-left font-medium">
                  Study ID
                </th>
                {formLabels.map(label => (
                  <th
                    key={label}
                    className="px-1 py-1 font-medium"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', maxWidth: 24 }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studyIds.map(id => (
                <tr key={id} className="hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <td className="sticky left-0 bg-white dark:bg-zinc-950 px-2 py-0.5 font-mono whitespace-nowrap">
                    {id}
                  </td>
                  {FORMS.map(f => {
                    const code = matrix.get(id)?.get(f.name) ?? 0;
                    return (
                      <td key={f.name} className="px-0.5 py-0.5" title={`${id} / ${f.label}: ${STATUS_LABELS[code]}`}>
                        <div className={`h-3.5 w-3.5 rounded-sm ${STATUS_COLORS[code]}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
