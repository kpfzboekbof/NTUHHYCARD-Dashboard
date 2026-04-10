import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'screening/';

/**
 * POST /api/screening/upload
 *
 * 接收院內 scraper 上傳的每日 OHCA 篩選結果。
 * 使用 API token 認證（不是 cookie）。
 *
 * Headers:
 *   Authorization: Bearer <SCREENING_API_TOKEN>
 *
 * Body:
 *   {
 *     "date": "2025-06-12",
 *     "site": "main" | "hsinchu" | "bio" | "yunlin",
 *     "siteName": "臺大醫院總院區",
 *     "displayGroup": "總院" | "新竹" | "雲林",
 *     "scannedAt": "2025-06-12T09:05:00",
 *     "patients": [ ... ]          // 可為空陣列代表「有掃但沒 OHCA」
 *   }
 */
export async function POST(request: NextRequest) {
  // Token 認證（scraper 用 API token，不是 cookie）
  const token = process.env.SCREENING_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: '伺服器未設定 SCREENING_API_TOKEN' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const provided = authHeader.replace('Bearer ', '').trim();
  if (provided !== token) {
    return NextResponse.json({ error: '認證失敗' }, { status: 401 });
  }

  // 檢查 Blob token 是否存在（常見的 500 元凶）
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: '伺服器未設定 BLOB_READ_WRITE_TOKEN' },
      { status: 500 }
    );
  }

  // 解析 body
  let body: {
    date?: string;
    site?: string;
    siteName?: string;
    displayGroup?: string;
    patients?: unknown[];
  };
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: 'JSON 解析失敗', detail: String(err) },
      { status: 400 }
    );
  }

  const { date, site, patients } = body;

  if (!date || !patients) {
    return NextResponse.json(
      { error: '缺少 date 或 patients 欄位' },
      { status: 400 }
    );
  }

  // 只允許白名單 site key（避免路徑被塞奇怪字元）
  const ALLOWED_SITES = ['main', 'hsinchu', 'bio', 'yunlin'];
  if (site && !ALLOWED_SITES.includes(site)) {
    return NextResponse.json(
      { error: `無效的 site: ${site}` },
      { status: 400 }
    );
  }

  // date 格式: "2025-06-12"
  const month = date.slice(0, 7); // "2025-06"
  // 新格式: {date}__{site}.json；沒給 site 則用舊檔名（legacy 相容）
  const blobPath = site
    ? `${BLOB_PREFIX}${month}/${date}__${site}.json`
    : `${BLOB_PREFIX}${month}/${date}.json`;

  // 存入 Vercel Blob
  try {
    const blob = await put(blobPath, JSON.stringify(body, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    console.log(
      `[screening/upload] Saved ${blobPath}, site=${site || '(legacy)'}, ${patients.length} patients`
    );

    return NextResponse.json({
      ok: true,
      date,
      site: site || null,
      patientsCount: patients.length,
      blobUrl: blob.url,
    });
  } catch (err) {
    console.error('[screening/upload] Blob put failed:', err);
    return NextResponse.json(
      {
        error: 'Vercel Blob 寫入失敗',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
