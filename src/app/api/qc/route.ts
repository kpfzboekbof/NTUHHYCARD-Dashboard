import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchQcRecords, fetchLogging } from '@/lib/redcap/client';
import { getAssignments, getTargetIds } from '@/lib/owner-store';
import { getUsers, getCompletionRowsCached } from '@/lib/redcap/service';
import { transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import { runRecordChecks, runBehaviorChecks } from '@/lib/redcap/qc-checks';
import type { QcResponse } from '@/types';

const CACHE_KEY = 'qc';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) await clearAllCache();

    const cached = !noCache ? await getCachedAsync<QcResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const [assignments, users, targetIds] = await Promise.all([
      getAssignments(),
      getUsers(),
      getTargetIds(),
    ]);

    // Fetch QC records and run record-level checks
    const qcRows = await fetchQcRecords();
    const recordFlags = runRecordChecks(qcRows);

    // Fetch logging data for behavior checks
    const rawLogs = await fetchLogging(3);
    const logs = transformLogs(rawLogs);

    // Need completion data for productivity stats. Pass targetIds so the F2
    // grades match the productivity page (they used to be computed against
    // the raw per-form targets here).
    const completionRows = await getCompletionRowsCached(assignments, users);
    const stats = calcLoggingStats(logs, completionRows, 3, assignments, users, targetIds);
    const behaviorFlags = runBehaviorChecks(
      logs.map(l => ({ timestamp: l.timestamp, username: l.username })),
      stats.byOwner,
    );

    const data: QcResponse = {
      recordFlags,
      behaviorFlags,
      fetchedAt: new Date().toISOString(),
    };

    setCached(CACHE_KEY, data, 300);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
