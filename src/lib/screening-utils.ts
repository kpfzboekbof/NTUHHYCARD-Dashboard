/** Shared helpers for the screening pages (daily list + monthly report). */

/** Mask the middle character of a name: 王小明 → 王O明 */
export function maskName(name: string): string {
  if (!name) return '';
  const chars = [...name];
  if (chars.length <= 1) return name;
  return chars[0] + 'O' + chars.slice(2).join('');
}

export function classLabel(cls: string): string {
  switch (cls) {
    case 'OHCA': return 'OHCA';
    case 'Prehospital_ROSC': return 'Prehospital ROSC';
    case 'Possible_OHCA': return 'Possible OHCA';
    default: return cls;
  }
}

export function classColor(cls: string): string {
  switch (cls) {
    case 'OHCA': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'Prehospital_ROSC': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 'Possible_OHCA': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    default: return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
  }
}
