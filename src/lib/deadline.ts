/**
 * Deadline arithmetic in Taipei days, with no dependencies.
 *
 * Both the reminder email and the batches page need it, and the mail module
 * reaches REDCap deep links (and through them Redis), which must never be
 * dragged into a client bundle.
 */

/** Whole Taipei days from today to `dueDate` (YYYY-MM-DD); negative when overdue. */
export function daysUntil(dueDate: string, now: Date = new Date()): number {
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = dueDate.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86_400_000);
}

export function deadlinePhrase(dueDate: string | null, now: Date = new Date()): string {
  if (!dueDate) return '';
  const days = daysUntil(dueDate, now);
  if (days < 0) return `已逾期 ${-days} 天`;
  if (days === 0) return '今天到期';
  return `還有 ${days} 天`;
}

/** Day of week in Taipei: 0 Sunday … 6 Saturday. */
export function taipeiWeekday(now: Date = new Date()): number {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay();
}

/**
 * Saturday or Sunday in Taipei. The hospital scrapers do not run at weekends,
 * so a missing upload on one is a calendar, not a fault. Public holidays are
 * not covered: there is no holiday table here, and inventing one would be
 * worse than saying so.
 */
export function isTaipeiWeekend(now: Date = new Date()): boolean {
  const day = taipeiWeekday(now);
  return day === 0 || day === 6;
}
