import { NextRequest, NextResponse } from 'next/server';
import { getCached, setCached } from '@/lib/cache';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchLogging, fetchUsers } from '@/lib/redcap/client';
import { getAssignments, getTargetIds } from '@/lib/owner-store';
import { transformCompletion, transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import type { CompletionResponse, LoggingResponse, User } from '@/types';

const USERS_CACHE_KEY = 'redcap_users';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '3');
    const cacheKey = `logging_${months}`;

    const cached = getCached<LoggingResponse>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const assignments = await getAssignments();

    let users = getCached<User[]>(USERS_CACHE_KEY);
    if (!users) {
      const rawUsers = await fetchUsers();
      users = rawUsers.map(u => ({
        username: u.username,
        name: `${u.lastname}${u.firstname}`,
      }));
      setCached(USERS_CACHE_KEY, users, 1800);
    }

    // Need completion data for stats calculation
    let completionRows = getCached<CompletionResponse>('completion')?.rows;
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

    const rawLogs = await fetchLogging(months);
    const logs = transformLogs(rawLogs);
    const targetIds = await getTargetIds();
    const stats = calcLoggingStats(logs, completionRows, months, assignments, users, targetIds);

    const data: LoggingResponse = {
      ...stats,
      fetchedAt: new Date().toISOString(),
    };

    setCached(cacheKey, data, 600);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
