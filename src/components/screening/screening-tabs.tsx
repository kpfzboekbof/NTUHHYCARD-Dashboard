'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/screening', label: '每日名單' },
  { href: '/screening/monthly', label: '月報表' },
] as const;

export function ScreeningTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b">
      {TABS.map(t => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              'px-4 py-2 text-sm font-medium transition-colors ' +
              (active
                ? 'border-b-2 border-red-500 text-red-700 dark:text-red-300'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
