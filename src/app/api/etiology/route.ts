import { NextResponse } from 'next/server';
import { getCached, setCached } from '@/lib/cache';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

const CACHE_KEY = 'etiology';

export async function GET() {
  try {
    const cached = getCached<EtiologyResponse>(CACHE_KEY);
    if (cached) {
      return NextResponse.json(cached);
    }

    const rawRows = await fetchEtiologyStatus();
    const { records, stats } = transformEtiology(rawRows);

    const data: EtiologyResponse = {
      records,
      stats,
      fetchedAt: new Date().toISOString(),
    };

    setCached(CACHE_KEY, data, 300);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
