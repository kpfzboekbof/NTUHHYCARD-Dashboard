import { NextResponse } from 'next/server';
import { getCached, setCached } from '@/lib/cache';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchUsers } from '@/lib/redcap/client';
import { getAssignments, getHiddenForms, getTargetIds } from '@/lib/owner-store';
import { transformCompletion, calcFormStats, calcOwnerStats } from '@/lib/redcap/transform';
import type { CompletionResponse, User } from '@/types';

const CACHE_KEY = 'completion';
const USERS_CACHE_KEY = 'redcap_users';

export async function GET() {
  try {
    const cached = getCached<CompletionResponse>(CACHE_KEY);
    if (cached) {
      return NextResponse.json(cached);
    }

    const assignments = getAssignments();
    const hiddenForms = getHiddenForms();

    // Fetch users with cache
    let users = getCached<User[]>(USERS_CACHE_KEY);
    if (!users) {
      const rawUsers = await fetchUsers();
      users = rawUsers.map(u => ({
        username: u.username,
        name: `${u.lastname}${u.firstname}`,
      }));
      setCached(USERS_CACHE_KEY, users, 1800);
    }

    const [raw, coreAssistantStatus, outcomeStatus] = await Promise.all([
      fetchCompletionStatus(),
      fetchCoreAssistantStatus(),
      fetchOutcomeStatus(),
    ]);
    const rows = transformCompletion(raw, assignments, users, {
      coreAssistant: coreAssistantStatus,
      outcomeAssistant: outcomeStatus.assistantStatus,
      outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
    });
    const visibleRows = rows.filter(r => !hiddenForms.includes(r.form));
    const byForm = calcFormStats(visibleRows);
    const byOwner = calcOwnerStats(visibleRows);

    // Count unique study IDs
    const allStudyIds = new Set(rows.map(r => r.studyId));
    const validStudyIds = new Set(rows.filter(r => !r.excluded).map(r => r.studyId));

    const data: CompletionResponse = {
      rows: visibleRows,
      byForm,
      byOwner,
      users,
      assignments,
      hiddenForms,
      targetIds: getTargetIds(),
      totalRecords: allStudyIds.size,
      validOhcaCount: validStudyIds.size,
      fetchedAt: new Date().toISOString(),
    };

    setCached(CACHE_KEY, data, 300);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
