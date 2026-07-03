import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { fetchLogging } from '@/lib/redcap/client';
import { getAssignments, getTargetIds } from '@/lib/owner-store';
import { getUsers, getCompletionRowsCached } from '@/lib/redcap/service';
import { transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import type { LoggingResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '3');
    const noCache = searchParams.get('noCache') === '1';
    const cacheKey = `logging_${months}`;

    if (noCache) await clearAllCache();

    const cached = !noCache ? await getCachedAsync<LoggingResponse>(cacheKey) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const [assignments, users] = await Promise.all([getAssignments(), getUsers()]);
    const completionRows = await getCompletionRowsCached(assignments, users);

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
