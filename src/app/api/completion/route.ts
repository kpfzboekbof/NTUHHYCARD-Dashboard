import { NextRequest, NextResponse } from 'next/server';
import { readView, viewPayload } from '@/lib/views/view';
import { completionView } from '@/lib/views/completion';

/**
 * GET /api/completion — the legacy completion matrix, packed.
 *
 * Answered from the last build (see src/lib/views); `noCache=1` is the
 * 重新抓取 button and waits for a fresh REDCap export. The body carries
 * `packed` rather than `rows`: the client hook unpacks it.
 */

export const runtime = 'nodejs';
// The background rebuild scheduled by readView runs inside this budget.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get('noCache') === '1';
    const result = await readView(completionView, { force });
    return NextResponse.json(viewPayload(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
