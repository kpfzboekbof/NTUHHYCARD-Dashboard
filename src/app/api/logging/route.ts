import { NextRequest, NextResponse } from 'next/server';
import { getRedcapUsers } from '@/lib/redcap/users';
import { readOwnerStore } from '@/lib/owner-store';
import { calcLoggingStats } from '@/lib/redcap/transform';
import { defineView, readView, viewPayload, type ViewDefinition } from '@/lib/views/view';
import { VIEW } from '@/lib/views/keys';
import { completionRows } from '@/lib/views/completion';
import { requireRedcapLogs } from '@/lib/views/logs';
import type { LoggingResponse } from '@/types';

/**
 * GET /api/logging?months=N — productivity per owner over a look-back window.
 *
 * Composed from two views (the completion rows and the REDCap log for the
 * window) and cheap to rebuild once those exist, so it never takes the REDCap
 * lease itself.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const views = new Map<number, ViewDefinition<LoggingResponse>>();

function loggingView(months: number): ViewDefinition<LoggingResponse> {
  let view = views.get(months);
  if (!view) {
    view = defineView<LoggingResponse>({
      key: VIEW.logging(months),
      freshSeconds: 900,
      async build(ctx) {
        const [{ assignments, targetIds }, users] = await Promise.all([readOwnerStore(), getRedcapUsers(ctx.force)]);
        // One after the other: this build does not export itself, so it runs
        // outside the REDCap gate, and two forced exporting inputs read in
        // parallel would race for the REDCap lease — the loser served from
        // its old copy without a rebuild.
        const rows = await completionRows(ctx);
        const logs = await requireRedcapLogs(months, ctx);
        const stats = calcLoggingStats(logs, rows, months, assignments, users, targetIds);
        return { ...stats, fetchedAt: new Date().toISOString() };
      },
    });
    views.set(months, view);
  }
  return view;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const months = Math.min(Math.max(parseInt(params.get('months') || '3') || 3, 1), 24);
    const force = params.get('noCache') === '1';
    const result = await readView(loggingView(months), { force });
    return NextResponse.json(viewPayload(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
