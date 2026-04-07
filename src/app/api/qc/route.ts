import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchQcRecords, fetchLogging, fetchUsers } from '@/lib/redcap/client';
import { getAssignments } from '@/lib/owner-store';
import { transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus } from '@/lib/redcap/client';
import { transformCompletion } from '@/lib/redcap/transform';
import { runRecordChecks, runBehaviorChecks } from '@/lib/redcap/qc-checks';
import type { CompletionResponse, User, QcResponse } from '@/types';

const CACHE_KEY = 'qc';
const USERS_CACHE_KEY = 'redcap_users';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) clearAllCache();

    const cached = !noCache ? await getCachedAsync<QcResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const assignments = await getAssignments();

    let users = await getCachedAsync<User[]>(USERS_CACHE_KEY);
    if (!users) {
      const rawUsers = await fetchUsers();
      users = rawUsers.map(u => ({
        username: u.username,
        name: `${u.lastname}${u.firstname}`,
      }));
      setCached(USERS_CACHE_KEY, users, 1800);
    }

    // Fetch QC records and run record-level checks
    const qcRows = await fetchQcRecords();
    const recordFlags = runRecordChecks(qcRows);

    // Fetch logging data for behavior checks
    const rawLogs = await fetchLogging(3);
    const logs = transformLogs(rawLogs);

    // Need completion data for productivity stats
    let completionRows = (await getCachedAsync<CompletionResponse>('completion'))?.rows;
    if (!completionRows) {
      const [raw, coreAssistantStatus, outcomeStatus] = await Promise.all([
        fetchCompletionStatus(),
        fetchCoreAssistantStatus(),
        fetchOutcomeStatus(),
      ]);
      completionRows = transformCompletion(raw, assignments, users, {
        coreAssistant: coreAssistantStatus,
        outcomeAssistant: outcomeStatus.assistantStatus,
        outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
      });
    }

    const stats = calcLoggingStats(logs, completionRows, 3, assignments, users);
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
