import { NextRequest, NextResponse } from 'next/server';
import { getCachedAsync, setCached, clearAllCache } from '@/lib/cache';
import { getAssignments, getHiddenForms, getTargetIds } from '@/lib/owner-store';
import { getUsers, buildCompletionRows } from '@/lib/redcap/service';
import { calcFormStats, calcOwnerStats } from '@/lib/redcap/transform';
import type { CompletionResponse } from '@/types';

const CACHE_KEY = 'completion';

export async function GET(request: NextRequest) {
  try {
    const noCache = request.nextUrl.searchParams.get('noCache') === '1';
    if (noCache) await clearAllCache();

    const cached = !noCache ? await getCachedAsync<CompletionResponse>(CACHE_KEY) : undefined;
    if (cached) {
      return NextResponse.json(cached);
    }

    const [assignments, hiddenForms, users] = await Promise.all([
      getAssignments(),
      getHiddenForms(),
      getUsers(),
    ]);

    const rows = await buildCompletionRows(assignments, users);
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
      targetIds: await getTargetIds(),
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
