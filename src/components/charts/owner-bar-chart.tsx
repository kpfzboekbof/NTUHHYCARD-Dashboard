'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getColor } from '@/lib/pct-color';

interface OwnerBarChartProps {
  data: { owner: string; pct: number }[];
}

/**
 * Chart body only — the surrounding Card stays in the page so it renders
 * immediately while recharts loads.
 */
export function OwnerBarChart({ data }: OwnerBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="owner" />
        <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} />
        <Tooltip formatter={(v) => [`${v}%`, 'Complete']} />
        <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
          {data.map((e, i) => (
            <Cell key={i} fill={getColor(e.pct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
