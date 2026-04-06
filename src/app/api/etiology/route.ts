import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

const CACHE_KEY = 'etiology';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) clearAllCache();

    const cached = !noCache ? await getCachedAsync<EtiologyResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const labelers = getLabelers();
    const rawRows = await fetchEtiologyStatus();
    const { records, stats } = transformEtiology(rawRows, labelers);

    const data: EtiologyResponse = {
      records,
      stats,
      labelers,
      fetchedAt: new Date().toISOString(),
    };

    setCached(CACHE_KEY, data, 300);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
