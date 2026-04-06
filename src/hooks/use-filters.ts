'use client';

import { createContext, useContext } from 'react';
import type { Filters } from '@/types';

export const defaultFilters: Filters = {
  owner: '全部',
  hospital: '全部',
  timeRange: '3months',
};

export const FiltersContext = createContext<{
  filters: Filters;
  setFilters: (f: Filters) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
}>({
  filters: defaultFilters,
  setFilters: () => {},
  setFilter: () => {},
});

export function useFilters() {
  return useContext(FiltersContext);
}
