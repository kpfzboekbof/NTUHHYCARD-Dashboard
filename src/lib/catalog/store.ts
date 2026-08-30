import { createVersionedStore } from '@/lib/store/versioned-store';
import { buildSeedCatalog } from './seed';
import type { CatalogDoc } from './types';

/**
 * Where the live catalog is read from.
 *
 * Until the admin editor exists the store is empty and every read falls back to
 * the seed, which reproduces the behaviour compiled into src/config/forms.ts.
 * That is what lets the state engine run against the catalog from day one
 * without waiting for the editing UI.
 */

function normalize(raw: unknown): CatalogDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Partial<CatalogDoc>;
  if (!Array.isArray(stored.units) || stored.units.length === 0 || !stored.settings) return null;
  return { units: stored.units, settings: stored.settings };
}

const store = createVersionedStore<CatalogDoc | null>({
  redisKey: 'catalog',
  localFile: 'catalog.json',
  normalize,
});

export interface CatalogSource {
  catalog: CatalogDoc;
  /** Version 0 with `isSeed` means nothing has been saved yet. */
  version: number;
  isSeed: boolean;
  /**
   * The store could not be read, so the seed is standing in for whatever is
   * actually saved. Callers surface this: silently deriving every cell from
   * the wrong rules would be worse than showing the dashboard is degraded.
   */
  readFailed: boolean;
}

export async function getCatalogSource(): Promise<CatalogSource> {
  const { version, data } = await store.read();
  const readFailed = version < 0;
  if (!data) {
    return { catalog: buildSeedCatalog(), version: readFailed ? -1 : 0, isSeed: true, readFailed };
  }
  return { catalog: data, version, isSeed: false, readFailed: false };
}

export async function getCatalog(): Promise<CatalogDoc> {
  return (await getCatalogSource()).catalog;
}
