import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { list, get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'screening/';

/** Read a private blob's JSON content via authenticated get(). */
async function readPrivateJson(pathname: string): Promise<unknown | null> {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Verify admin auth (cookie-based, for Dashboard UI) */
async function isAuthenticated(): Promise<boolean> {
  const adminPw = process.env.ADMIN_PASSWORD || '';
  if (!adminPw) return false;
  const data = `${adminPw}-ohca-admin-salt`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  const expected = Math.abs(hash).toString(36);
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token === expected;
}

/**
 * GET /api/screening?month=2025-06
 *
 * 讀取指定月份的所有每日 JSON（從 Vercel Blob），合併回傳。
 */
export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  const month = request.nextUrl.searchParams.get('month')
    || new Date().toISOString().slice(0, 7);

  // 列出此月份的所有 blob
  const prefix = `${BLOB_PREFIX}${month}/`;
  const { blobs } = await list({ prefix });

  // 讀取審核紀錄
  let reviews: Record<string, { decision: string; reviewedAt: string }> = {};
  const reviewBlob = blobs.find(b => b.pathname.endsWith('/_reviews.json'));
  if (reviewBlob) {
    const content = await readPrivateJson(reviewBlob.pathname);
    if (content && typeof content === 'object') {
      reviews = content as typeof reviews;
    }
  }

  // site_key → displayGroup 對照（生醫歸在新竹）
  const SITE_TO_GROUP: Record<string, string> = {
    main: '總院',
    hsinchu: '新竹',
    bio: '新竹',
    yunlin: '雲林',
  };

  // 讀取每日 JSON
  const allPatients: Record<string, unknown>[] = [];
  const datesSet = new Set<string>();
  // 每個院區已掃描的日期
  const scannedByGroup: Record<string, Set<string>> = {
    '總院': new Set(),
    '新竹': new Set(),
    '雲林': new Set(),
  };

  const dayBlobs = blobs
    .filter(b => b.pathname.endsWith('.json') && !b.pathname.endsWith('_reviews.json'))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));

  for (const blob of dayBlobs) {
    const filename = blob.pathname.split('/').pop() || '';
    const base = filename.replace('.json', '');
    // 新格式: "2025-06-12__hsinchu"；舊格式: "2025-06-12"
    let dateStr = base;
    let siteKey: string | null = null;
    const sepIdx = base.indexOf('__');
    if (sepIdx > 0) {
      dateStr = base.slice(0, sepIdx);
      siteKey = base.slice(sepIdx + 2);
    }
    datesSet.add(dateStr);

    const content = await readPrivateJson(blob.pathname) as
      | { patients?: Record<string, unknown>[]; displayGroup?: string }
      | null;
    if (!content) continue;

    // 標記此院區此日已掃描
    const groupFromPayload =
      typeof content.displayGroup === 'string' ? content.displayGroup : null;
    const group = groupFromPayload || (siteKey ? SITE_TO_GROUP[siteKey] : null);
    if (group && scannedByGroup[group]) {
      scannedByGroup[group].add(dateStr);
    } else if (!siteKey) {
      // Legacy 檔案（沒 site 資訊）→ 保守地標記所有院區
      for (const g of Object.keys(scannedByGroup)) {
        scannedByGroup[g].add(dateStr);
      }
    }

    for (const patient of content.patients || []) {
      const id = patient.id as string | undefined;
      if (id && reviews[id]) {
        patient.reviewed = reviews[id].decision;
        patient.reviewedAt = reviews[id].reviewedAt;
      }
      allPatients.push(patient);
    }
  }

  const dates = [...datesSet].sort();
  const scannedByGroupArr: Record<string, string[]> = {};
  for (const [g, s] of Object.entries(scannedByGroup)) {
    scannedByGroupArr[g] = [...s].sort();
  }

  // 計算可用月份
  const allBlobs = await list({ prefix: BLOB_PREFIX });
  const monthSet = new Set<string>();
  for (const b of allBlobs.blobs) {
    const parts = b.pathname.replace(BLOB_PREFIX, '').split('/');
    if (parts[0] && /^\d{4}-\d{2}$/.test(parts[0])) {
      monthSet.add(parts[0]);
    }
  }
  const availableMonths = [...monthSet].sort().reverse();

  return NextResponse.json({
    month,
    dates,
    scannedByGroup: scannedByGroupArr,
    patients: allPatients,
    availableMonths,
    fetchedAt: new Date().toISOString(),
  });
}
