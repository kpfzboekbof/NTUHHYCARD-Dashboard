import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { isAdminRequest } from '@/lib/admin-auth';
import { fetchEtiologyStatus, importEtiologyFinal, batchImportField } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import type { EtiologyResponse } from '@/lib/redcap/etiology-transform';

const CACHE_KEY = 'etiology';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) await clearAllCache();

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
    if (!(await isAdminRequest())) {
      return NextResponse.json({ error: '未授權，請先以管理員身份登入' }, { status: 401 });
    }

    const body = await request.json();

    // Batch mode — used by the consensus meeting "auto-fill green" flow.
    if (Array.isArray(body.updates)) {
      const updates = body.updates as Array<{ studyId: string; code: number }>;
      const cleaned = updates.filter(
        u => typeof u?.studyId === 'string' && u.studyId !== '' && Number.isInteger(u?.code),
      );
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'updates 為空或格式不正確' }, { status: 400 });
      }
      const records = cleaned.map(u => ({ study_id: u.studyId, etiology_final: String(u.code) }));
      const count = await batchImportField(records);
      await clearAllCache();
      return NextResponse.json({ ok: true, count });
    }

    const { studyId, code } = body as { studyId?: string; code?: number };
    if (!studyId || code === undefined || code === null) {
      return NextResponse.json({ error: '缺少 studyId 或 code 參數' }, { status: 400 });
    }

    await importEtiologyFinal(studyId, code);

    // Clear etiology cache so next fetch reflects the change
    await clearAllCache();

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
