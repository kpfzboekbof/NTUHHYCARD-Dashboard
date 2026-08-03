'use client';

import dynamic from 'next/dynamic';

/**
 * recharts is ~360 KB raw / ~105 KB gzip and was statically imported by
 * /dashboard, /owners and /productivity — so it sat on the hydration critical
 * path of all three, even though every one of those pages renders a
 * 「載入中...」 placeholder until its SWR request resolves and the chart is
 * never visible at first paint.
 *
 * `ssr: false` keeps it out of the server bundle too; the skeletons match each
 * chart's real height so nothing shifts when it swaps in.
 */

function skeleton(style: React.CSSProperties) {
  const Skeleton = () => (
    <div
      className="animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"
      style={style}
    />
  );
  Skeleton.displayName = 'ChartSkeleton';
  return Skeleton;
}

export const LazyFormBarChartBody = dynamic(
  () => import('@/components/charts/form-bar-chart-body').then(m => m.FormBarChartBody),
  // The real height is data-dependent; 400 is its floor, and the Card grows
  // downward so a taller chart pushes nothing above it.
  { ssr: false, loading: skeleton({ height: 400 }) },
);

export const LazyOwnerBarChart = dynamic(
  () => import('@/components/charts/owner-bar-chart').then(m => m.OwnerBarChart),
  { ssr: false, loading: skeleton({ height: 300 }) },
);

export const LazyProductivityTimelineChart = dynamic(
  () => import('@/components/charts/productivity-timeline-chart').then(m => m.ProductivityTimelineChart),
  { ssr: false, loading: skeleton({ height: 300 }) },
);
