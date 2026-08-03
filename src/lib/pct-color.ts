/** Shared completion-percentage colour ramp (green / amber / red). */
export function getColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}
