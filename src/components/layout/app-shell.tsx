'use client';

import { useState, useCallback } from 'react';
import { Menu } from 'lucide-react';
import { SWRConfig } from 'swr';
import { Sidebar } from './sidebar';
import { FiltersContext, defaultFilters } from '@/hooks/use-filters';
import type { Filters } from '@/types';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const setFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  return (
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <FiltersContext.Provider value={{ filters, setFilters, setFilter }}>
        {/* Top bar with hamburger */}
        <div className="fixed top-0 left-0 z-50 flex h-12 w-12 items-center justify-center">
          <button
            onClick={() => setSidebarOpen(prev => !prev)}
            className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {/* Backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar overlay */}
        <div
          className={`fixed left-0 top-0 z-50 h-screen transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>

        <main className="min-h-screen">
          {children}
        </main>
      </FiltersContext.Provider>
    </SWRConfig>
  );
}
