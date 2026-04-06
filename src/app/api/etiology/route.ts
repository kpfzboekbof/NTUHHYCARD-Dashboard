import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchEtiologyStatus, importEtiologyFinal } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

function generateAdminToken(): string {
  const adminPw = process.env.ADMIN_PASSWORD || '';
  const data = `${adminPw}-ohca-admin-salt`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const CACHE_KEY = 'etiology';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) clearAllCache();

    const cached = !noCache ? await getCachedAsync<EtiologyResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const labelers = await getLabelers();
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

export async function POST(request: NextRequest) {
  try {
    // Verify admin auth
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_token')?.value;
    const expected = generateAdminToken();
    const adminPw = process.env.ADMIN_PASSWORD || '';
    if (!adminPw || !token || token !== expected) {
      return NextResponse.json({ error: '未授權，請先以管理員身份登入' }, { status: 401 });
    }

    const body = await request.json();
    const { studyId, code } = body as { studyId?: string; code?: number };
    if (!studyId || code === undefined || code === null) {
      return NextResponse.json({ error: '缺少 studyId 或 code 參數' }, { status: 400 });
    }

    await importEtiologyFinal(studyId, code);

    // Clear etiology cache so next fetch reflects the change
    clearAllCache();

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
