import Link from 'next/link';
import {
  LayoutDashboard, Grid3X3, Users, ListChecks, Keyboard, Stethoscope,
} from 'lucide-react';

const PAGES = [
  { href: '/dashboard',    label: '總覽',       desc: '檢視整體完成率與各表單進度',     icon: LayoutDashboard, color: 'bg-blue-500' },
  { href: '/heatmap',      label: '熱力圖',     desc: '以熱力圖呈現各記錄完成狀態',     icon: Grid3X3,         color: 'bg-emerald-500' },
  { href: '/owners',       label: '負責人進度', desc: '各負責人的完成率與統計分析',       icon: Users,           color: 'bg-violet-500' },
  { href: '/etiology',     label: 'Etiology',   desc: '追蹤病因共識審查進度與 final 完成狀態', icon: Stethoscope, color: 'bg-teal-500' },
  { href: '/incomplete',   label: '未完成清單', desc: '列出所有未完成與未驗證的記錄',     icon: ListChecks,      color: 'bg-rose-500' },
  { href: '/productivity', label: '鍵入進度',   desc: '追蹤各負責人的鍵入活動與時間軸',  icon: Keyboard,        color: 'bg-cyan-500' },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">OHCA REDCap Dashboard</h1>
      <p className="mb-10 text-zinc-500">選擇要查看的功能</p>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PAGES.map(page => (
          <Link
            key={page.href}
            href={page.href}
            className="group flex flex-col rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 dark:bg-zinc-900 dark:border-zinc-800"
          >
            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-white ${page.color}`}>
              <page.icon className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold group-hover:text-blue-600">{page.label}</h2>
            <p className="mt-1 text-xs text-zinc-500">{page.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
