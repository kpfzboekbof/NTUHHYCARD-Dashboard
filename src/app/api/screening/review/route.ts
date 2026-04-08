import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'screening');

/** Verify admin auth */
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
 * POST /api/screening/review
 *
 * 審核 Possible_OHCA 病人。
 * Body: { id: string, decision: "confirmed" | "excluded", month: "2025-06" }
 */
export async function POST(request: NextRequest) {
  if (!await isAuthenticated()) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  const body = await request.json();
  const { id, decision, month } = body;

  if (!id || !decision || !month) {
    return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
  }

  if (!['confirmed', 'excluded'].includes(decision)) {
    return NextResponse.json({ error: '決定只能是 confirmed 或 excluded' }, { status: 400 });
  }

  const monthDir = path.join(DATA_DIR, month);
  if (!fs.existsSync(monthDir)) {
    return NextResponse.json({ error: '找不到此月份資料' }, { status: 404 });
  }

  const reviewPath = path.join(monthDir, '_reviews.json');

  // 讀取現有審核紀錄
  let reviews: Record<string, { decision: string; reviewedAt: string }> = {};
  if (fs.existsSync(reviewPath)) {
    reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
  }

  // 更新或新增
  reviews[id] = {
    decision,
    reviewedAt: new Date().toISOString(),
  };

  fs.writeFileSync(reviewPath, JSON.stringify(reviews, null, 2), 'utf-8');

  return NextResponse.json({ ok: true, id, decision });
}
