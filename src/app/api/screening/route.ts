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
 * GET /api/screening?month=2025-06
 *
 * 讀取指定月份的所有每日 JSON，合併回傳。
 * 只回傳 OHCA / Possible_OHCA / Prehospital_ROSC 的病人，
 * 以及已審核通過的 Possible_OHCA。
 */
export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  const month = request.nextUrl.searchParams.get('month')
    || new Date().toISOString().slice(0, 7);

  const monthDir = path.join(DATA_DIR, month);
  const reviewPath = path.join(monthDir, '_reviews.json');

  // 讀取審核決定
  let reviews: Record<string, { decision: string; reviewedAt: string }> = {};
  if (fs.existsSync(reviewPath)) {
    reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
  }

  // 讀取所有每日 JSON
  const allPatients: Record<string, unknown>[] = [];
  const dates: string[] = [];

  if (fs.existsSync(monthDir)) {
    const files = fs.readdirSync(monthDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .sort();

    for (const file of files) {
      const dateStr = file.replace('.json', '');
      dates.push(dateStr);

      const content = JSON.parse(
        fs.readFileSync(path.join(monthDir, file), 'utf-8')
      );

      for (const patient of content.patients || []) {
        // 合併審核狀態
        const review = reviews[patient.id];
        if (review) {
          patient.reviewed = review.decision;
          patient.reviewedAt = review.reviewedAt;
        }
        allPatients.push(patient);
      }
    }
  }

  // 計算可用月份列表
  const availableMonths: string[] = [];
  if (fs.existsSync(DATA_DIR)) {
    const dirs = fs.readdirSync(DATA_DIR)
      .filter(d => /^\d{4}-\d{2}$/.test(d))
      .sort()
      .reverse();
    availableMonths.push(...dirs);
  }

  return NextResponse.json({
    month,
    dates,
    patients: allPatients,
    availableMonths,
    fetchedAt: new Date().toISOString(),
  });
}
