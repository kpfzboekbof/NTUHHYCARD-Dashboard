import { NextRequest, NextResponse } from 'next/server';
import { fetchQcRecords } from '@/lib/redcap/client';
import { getRedcapUsers } from '@/lib/redcap/users';
import { getAssignments } from '@/lib/owner-store';
import { calcLoggingStats } from '@/lib/redcap/transform';
import { runRecordChecks, runBehaviorChecks } from '@/lib/redcap/qc-checks';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { defineView, readView, viewPayload } from '@/lib/views/view';
import { VIEW } from '@/lib/views/keys';
import { completionRows } from '@/lib/views/completion';
import { redcapLogs } from '@/lib/views/logs';
import type { QcResponse } from '@/types';

/**
 * GET /api/qc — record-level and behaviour-level QC flags.
 *
 * One REDCap export of its own (the QC field set), plus the completion and
 * log views it shares with the other pages.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const LOG_MONTHS = 3;

const qcView = defineView<QcResponse>({
  key: VIEW.qc,
  freshSeconds: 900,
  exportsFromRedcap: true,

  async build(ctx) {
    const [assignments, users] = await Promise.all([getAssignments(), getRedcapUsers(ctx.force)]);

    const recordFlags = runRecordChecks(await fetchQcRecords());

    const [logs, rows] = await Promise.all([
      redcapLogs(LOG_MONTHS, ctx),
      completionRows(ctx),
    ]);
    const stats = calcLoggingStats(logs, rows, LOG_MONTHS, assignments, users);
    const behaviorFlags = runBehaviorChecks(
      logs.map(l => ({ timestamp: l.timestamp, username: l.username })),
      stats.byOwner,
    );

    return {
      recordFlags,
      behaviorFlags,
      redcapBaseUrl: await getDataEntryBase(ctx.force),
      fetchedAt: new Date().toISOString(),
    };
  },
});

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get('noCache') === '1';
    const result = await readView(qcView, { force });
    return NextResponse.json(viewPayload(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
