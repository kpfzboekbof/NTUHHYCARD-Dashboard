import { NextRequest, NextResponse, after } from 'next/server';
import { getCachedAsync, setCached, invalidate, singleFlight } from '@/lib/cache';
import { fetchQcRecords, fetchLogging, fetchUsers } from '@/lib/redcap/client';
import { getOwnerStore } from '@/lib/owner-store';
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
    // This route reads the shared 'completion' entry below, so a refresh press
    // must drop that too — but not every other route's cache.
    if (noCache) await invalidate([CACHE_KEY, 'completion']);

    const cached = !noCache ? await getCachedAsync<QcResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const data = await singleFlight(CACHE_KEY, async () => {
      const store = await getOwnerStore();
      const assignments = store.assignments ?? {};

      let users = await getCachedAsync<User[]>(USERS_CACHE_KEY);
      if (!users) {
        const rawUsers = await fetchUsers();
        users = rawUsers.map(u => ({
          username: u.username,
          name: `${u.lastname}${u.firstname}`,
        }));
        after(setCached(USERS_CACHE_KEY, users, 1800));
      }

      // These three phases used to run strictly one after another even though
      // none of them depends on the others — the route's network time was
      // additive rather than overlapped.
      const [qcRows, rawLogs, cachedCompletion] = await Promise.all([
        fetchQcRecords(),
        fetchLogging(3),
        getCachedAsync<CompletionResponse>('completion'),
      ]);

      const recordFlags = runRecordChecks(qcRows);
      const logs = transformLogs(rawLogs);

      // Need completion data for productivity stats
      let completionRows = cachedCompletion?.rows;
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

      const fresh: QcResponse = {
        recordFlags,
        behaviorFlags,
        fetchedAt: new Date().toISOString(),
      };

      after(setCached(CACHE_KEY, fresh, 300));
      return fresh;
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
