import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { listWorkEvents } from '@/lib/db/events';

/**
 * GET /api/events — the handoff stream, filterable.
 *
 * Feeds the patient timeline and ad-hoc "what changed lately" questions. The
 * queue views do not read this to decide what exists — only to say since when.
 */

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireRole('viewer');
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const events = await listWorkEvents({
      eventType: params.get('type') ?? undefined,
      unitId: params.get('unit') ?? undefined,
      studyId: params.get('studyId') ?? undefined,
      since: params.get('since') ?? undefined,
      limit: Number(params.get('limit')) || undefined,
    });
    return NextResponse.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
