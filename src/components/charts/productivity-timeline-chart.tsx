'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface ProductivityTimelineChartProps {
  data: { week: string; entries: number }[];
}

/**
 * Chart body only — the surrounding Card stays in the page so it renders
 * immediately while recharts loads.
 */
export function ProductivityTimelineChart({ data }: ProductivityTimelineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tickFormatter={v => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          tick={{ fontSize: 11 }}
        />
        <YAxis />
        <Tooltip
          labelFormatter={v => {
            const d = new Date(v as string);
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 週`;
          }}
          formatter={(v) => [v, '鍵入次數']}
        />
        <Line
          type="monotone"
          dataKey="entries"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
