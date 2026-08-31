import { NextRequest, NextResponse } from 'next/server';
import { get, put } from '@vercel/blob';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';
import type { ScreeningReview } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'screening/';

/**
 * POST /api/screening/review
 *
 * 審核 Possible_OHCA 病人。
 * Body: { id: string, decision: "confirmed" | "excluded", month: "2025-06" }
 *
 * The stored decision now carries who made it. It used to be
 * `{decision, reviewedAt}` — a judgement about whether a patient enters the
 * study, with nobody's name on it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { id, decision, month } = body;

  if (!id || !decision || !month) {
    return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
  }

  if (!['confirmed', 'excluded'].includes(decision)) {
    return NextResponse.json({ error: '決定只能是 confirmed 或 excluded' }, { status: 400 });
  }

  const reviewPath = `${BLOB_PREFIX}${month}/_reviews.json`;

  // 讀取現有審核紀錄（private blob）
  let reviews: Record<string, ScreeningReview> = {};
  try {
    const result = await get(reviewPath, { access: 'private' });
    if (result && result.statusCode === 200 && result.stream) {
      const text = await new Response(result.stream).text();
      reviews = JSON.parse(text);
    }
  } catch {
    // 不存在就用空物件
  }

  const before = reviews[id];

  // 更新
  reviews[id] = {
    decision,
    reviewedAt: new Date().toISOString(),
    decidedBy: {
      personId: auth.identity.personId,
      label: 'personId' in auth.identity.actor
        ? auth.identity.actor.personId
        : auth.identity.actor.tokenName,
    },
  };

  try {
    await put(reviewPath, JSON.stringify(reviews, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Vercel Blob 寫入失敗',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  await recordAudit({
    actor: auth.identity.actor,
    action: 'screening.review',
    entityType: 'screening_case',
    entityId: `${month}/${id}`,
    before,
    after: reviews[id],
  });

  return NextResponse.json({ ok: true, id, decision });
}
