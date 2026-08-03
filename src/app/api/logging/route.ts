import { NextRequest, NextResponse, after } from 'next/server';
import { getCachedAsync, setCached, invalidate, singleFlight } from '@/lib/cache';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchLogging, fetchUsers } from '@/lib/redcap/client';
import { getOwnerStore, pickTargetIds } from '@/lib/owner-store';
import { transformCompletion, transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import type { CompletionResponse, LoggingResponse, User } from '@/types';

const USERS_CACHE_KEY = 'redcap_users';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '3');
    const noCache = searchParams.get('noCache') === '1';
    const cacheKey = `logging_${months}`;

    // This route reads the shared 'completion' entry below, so a refresh press
    // must drop that too — but not every other route's cache.
    if (noCache) await invalidate([cacheKey, 'completion']);

    const cached = !noCache ? await getCachedAsync<LoggingResponse>(cacheKey) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const data = await singleFlight(cacheKey, async () => {
      // One owner-store read covers both assignments and targetIds; targetIds
      // used to be a second, fully serial round trip after all the REDCap work.
      const store = await getOwnerStore();
      const assignments = store.assignments ?? {};
      const targetIds = pickTargetIds(store);

      let users = await getCachedAsync<User[]>(USERS_CACHE_KEY);
      if (!users) {
        const rawUsers = await fetchUsers();
        users = rawUsers.map(u => ({
          username: u.username,
          name: `${u.lastname}${u.firstname}`,
        }));
        after(setCached(USERS_CACHE_KEY, users, 1800));
      }

      // The REDCap log export does not depend on the completion data, so the
      // two phases overlap instead of running back to back.
      const [cachedCompletion, rawLogs] = await Promise.all([
        getCachedAsync<CompletionResponse>('completion'),
        fetchLogging(months),
      ]);

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

      const logs = transformLogs(rawLogs);
      const stats = calcLoggingStats(logs, completionRows, months, assignments, users, targetIds);

      const fresh: LoggingResponse = {
        ...stats,
        fetchedAt: new Date().toISOString(),
      };

      after(setCached(cacheKey, fresh, 600));
      return fresh;
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
