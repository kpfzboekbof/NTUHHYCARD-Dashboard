import { NextRequest, NextResponse, after } from 'next/server';
import { getCachedAsync, setCached, invalidate, singleFlight } from '@/lib/cache';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchUsers, fetchTraumaEligibleIds } from '@/lib/redcap/client';
import { getOwnerStore, pickTargetIds } from '@/lib/owner-store';
import { transformCompletion, calcFormStats, calcOwnerStats } from '@/lib/redcap/transform';
import type { CompletionResponse, User } from '@/types';

const CACHE_KEY = 'completion';
const USERS_CACHE_KEY = 'redcap_users';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    // Targeted, not global: the users cache (30 min) and every other route's
    // cache used to be flushed by a single refresh-button press.
    if (noCache) await invalidate([CACHE_KEY]);

    const cached = !noCache ? await getCachedAsync<CompletionResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    // Every open tab polls on the same 5-minute interval as the server TTL, so
    // they all expire together. Collapse the stampede into one REDCap load.
    const data = await singleFlight(CACHE_KEY, async () => {
      // One read of the owner-store blob instead of three round trips
      // (getAssignments + getHiddenForms + a serial getTargetIds at the end).
      const store = await getOwnerStore();
      const assignments = store.assignments ?? {};
      const hiddenForms = store.hiddenForms ?? [];

      // Fetch users with cache
      let users = await getCachedAsync<User[]>(USERS_CACHE_KEY);
      if (!users) {
        const rawUsers = await fetchUsers();
        users = rawUsers.map(u => ({
          username: u.username,
          name: `${u.lastname}${u.firstname}`,
        }));
        after(setCached(USERS_CACHE_KEY, users, 1800));
      }

      const [raw, coreAssistantStatus, outcomeStatus, traumaIds] = await Promise.all([
        fetchCompletionStatus(),
        fetchCoreAssistantStatus(),
        fetchOutcomeStatus(),
        fetchTraumaEligibleIds(),
      ]);
      const rows = transformCompletion(raw, assignments, users, {
        coreAssistant: coreAssistantStatus,
        outcomeAssistant: outcomeStatus.assistantStatus,
        outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
      }, traumaIds);
      const visibleRows = rows.filter(r => !hiddenForms.includes(r.form));
      const byForm = calcFormStats(visibleRows);
      const byOwner = calcOwnerStats(visibleRows);

      // Count unique study IDs
      const allStudyIds = new Set(rows.map(r => r.studyId));
      const validStudyIds = new Set(rows.filter(r => !r.excluded).map(r => r.studyId));

      const fresh: CompletionResponse = {
        rows: visibleRows,
        byForm,
        byOwner,
        users,
        assignments,
        hiddenForms,
        targetIds: pickTargetIds(store),
        totalRecords: allStudyIds.size,
        validOhcaCount: validStudyIds.size,
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
