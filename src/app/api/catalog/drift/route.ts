import { NextResponse } from 'next/server';
import { getCachedAsync, setCached } from '@/lib/cache';
import { fetchMetadata, fetchRedcapVersion } from '@/lib/redcap/client';
import { getCatalogSource } from '@/lib/catalog/store';
import { detectDrift, type DriftReport } from '@/lib/catalog/drift';
import { validateCatalog } from '@/lib/catalog/validate';

/**
 * GET /api/catalog/drift
 *
 * Compares the work-unit catalog against REDCap's live data dictionary, so a
 * renamed or retired instrument surfaces here instead of as a form that quietly
 * sits at 0% forever.
 */

const CACHE_KEY = 'catalog-drift';
const CACHE_TTL_SECONDS = 3600;

interface DriftResponse extends DriftReport {
  redcapVersion: string;
  structuralIssues: ReturnType<typeof validateCatalog>;
  catalogVersion: number;
  catalogIsSeed: boolean;
  fetchedAt: string;
}

export async function GET() {
  try {
    const cached = await getCachedAsync<DriftResponse>(CACHE_KEY);
    if (cached) return NextResponse.json(cached);

    const { catalog, version, isSeed } = await getCatalogSource();
    const [metadata, redcapVersion] = await Promise.all([fetchMetadata(), fetchRedcapVersion()]);

    const data: DriftResponse = {
      ...detectDrift(catalog, metadata),
      redcapVersion,
      structuralIssues: validateCatalog(catalog),
      catalogVersion: version,
      catalogIsSeed: isSeed,
      fetchedAt: new Date().toISOString(),
    };

    setCached(CACHE_KEY, data, CACHE_TTL_SECONDS);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
