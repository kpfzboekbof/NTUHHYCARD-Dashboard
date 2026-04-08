'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home, LayoutDashboard, Grid3X3, Users, Shield, ListChecks, Keyboard, Stethoscope, ShieldCheck, HeartPulse,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/',              label: '首頁',         icon: Home },
  { href: '/dashboard',     label: '總覽',         icon: LayoutDashboard },
  { href: '/owners',        label: '負責人進度',   icon: Users },
  { href: '/incomplete',    label: '未完成清單',   icon: ListChecks },
  { href: '/etiology',      label: 'Etiology',     icon: Stethoscope },
  { href: '/qc',            label: '品質管制',     icon: ShieldCheck },
  { href: '/heatmap',       label: '熱力圖',       icon: Grid3X3 },
  { href: '/productivity',  label: '鍵入進度',     icon: Keyboard },
  { href: '/screening',     label: 'OHCA病人擷取', icon: HeartPulse },
  { href: '/assign',        label: '管理者',       icon: Shield },
];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="h-screen w-56 border-r bg-white dark:bg-zinc-950">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-lg font-bold text-blue-600">OHCA REDCap</span>
      </div>
      <nav className="space-y-1 p-3">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
