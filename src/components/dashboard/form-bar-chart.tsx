'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FormStats } from '@/types';

function getColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

interface FormBarChartProps {
  data: FormStats[];
}

export function FormBarChart({ data }: FormBarChartProps) {
  const sorted = [...data].sort((a, b) => a.pctComplete - b.pctComplete);

  return (
    <Card>
      <CardHeader>
        <CardTitle>各表單完成率</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(400, sorted.length * 28)}>
          <BarChart data={sorted} layout="vertical" margin={{ left: 120, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(v) => [`${v}%`, 'Complete']}
              labelFormatter={(label) => {
                const item = sorted.find(d => d.label === label);
                return item ? `${label} (${item.owner})` : label;
              }}
            />
            <Bar dataKey="pctComplete" radius={[0, 4, 4, 0]}>
              {sorted.map((entry, i) => (
                <Cell key={i} fill={getColor(entry.pctComplete)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
