'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getColor } from '@/lib/pct-color';
import type { FormStats } from '@/types';

interface FormBarChartBodyProps {
  data: FormStats[];
  height: number;
}

/**
 * Chart body only — the surrounding Card stays in the page so it renders
 * immediately while recharts loads.
 */
export function FormBarChartBody({ data, height }: FormBarChartBodyProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 120, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
        <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
        <Tooltip
          formatter={(v) => [`${v}%`, 'Complete']}
          labelFormatter={(label) => {
            const item = data.find(d => d.label === label);
            return item ? `${label} (${item.owner})` : label;
          }}
        />
        <Bar dataKey="pctComplete" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={getColor(entry.pctComplete)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
