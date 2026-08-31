import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { listOutboundMail, lastNudgeByPerson } from '@/lib/db/outbound-mail';
import { hasDatabase } from '@/lib/db/client';

/**
 * GET /api/outbound-mail — the delivery ledger.
 *
 * Answers the questions one global reminderSentAt never could: how many times
 * was this person chased this month, and did the last mail actually leave.
 */

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  if (!hasDatabase()) {
    return NextResponse.json({ error: '未設定 OHCA_DATABASE_URL：寄信紀錄無法使用' }, { status: 503 });
  }

  try {
    const params = request.nextUrl.searchParams;
    const [mail, lastNudge] = await Promise.all([
      listOutboundMail({
        personId: params.get('person') ?? undefined,
        kind: params.get('kind') ?? undefined,
        limit: Number(params.get('limit')) || undefined,
      }),
      lastNudgeByPerson(),
    ]);
    return NextResponse.json({ mail, lastNudge: Object.fromEntries(lastNudge) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
