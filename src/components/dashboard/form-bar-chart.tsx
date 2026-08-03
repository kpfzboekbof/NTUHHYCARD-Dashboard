'use client';

import { useMemo } from 'react';
import { LazyFormBarChartBody } from '@/components/charts/lazy-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FormStats } from '@/types';

interface FormBarChartProps {
  data: FormStats[];
}

export function FormBarChart({ data }: FormBarChartProps) {
  const sorted = useMemo(
    () => [...data].sort((a, b) => a.pctComplete - b.pctComplete),
    [data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>各表單完成率</CardTitle>
      </CardHeader>
      <CardContent>
        <LazyFormBarChartBody data={sorted} height={Math.max(400, sorted.length * 28)} />
      </CardContent>
    </Card>
  );
}
