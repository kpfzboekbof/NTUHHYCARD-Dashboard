import { NextRequest, NextResponse } from 'next/server';
import { fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchLogging, fetchUsers } from '@/lib/redcap/client';
import { getOwnerStore, pickTargetIds } from '@/lib/owner-store';
import { transformCompletion, transformLogs, calcLoggingStats } from '@/lib/redcap/transform';
import type { OwnerProductivity, User } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/report/weekly
 *
 * 給排程機器（personal_assistance 的週報 routine）讀取的成員登錄狀況摘要。
 * 用 API token 認證（不是 cookie）—— 比照 /api/screening/upload，並已在 proxy.ts 的
 * matcher 豁免，使排程容器能以 Bearer token 直接讀取，不需登入。
 *
 * Headers:
 *   Authorization: Bearer <REPORT_API_TOKEN>
 *
 * 回傳穩定契約（鍵用英文，敘述由 PA 端產生）：
 *   {
 *     "generatedAt": ISO,
 *     "periodMonths": 1,             // members 的累計統計回看區間
 *     "thresholds": { "staleDays": 14, "weekDays": 7 },
 *     "members": OwnerProductivity[] // 依完成率由高到低排序
 *     "exceptions": {
 *       "behind":          string[]  // grade === '落後'
 *       "noEntryThisWeek": string[]  // 近 weekDays 天 0 筆（daysSince 為 null 或 >= weekDays）
 *       "stale":           string[]  // daysSince >= staleDays（久未登錄）
 *     }
 *   }
 *
 * 異常判定刻意放在這裡算好，PA 端只負責敘述 —— 契約穩定、兩邊不會各算各的。
 */

const STALE_DAYS_DEFAULT = 14;
const WEEK_DAYS = 7;
// Mirrors UNASSIGNED in lib/redcap/transform.ts — the catch-all bucket for forms
// with no assigned owner. It is not a person, so it is kept out of `members`
// and `exceptions` (you cannot nudge it) and surfaced separately as `unassigned`.
const UNASSIGNED = '未指派';

export async function GET(request: NextRequest) {
  // Token 認證（排程機器用 API token，不是 cookie）
  const token = process.env.REPORT_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: '伺服器未設定 REPORT_API_TOKEN' },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get('authorization') || '';
  const provided = authHeader.replace('Bearer ', '').trim();
  if (provided !== token) {
    return NextResponse.json({ error: '認證失敗' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '1');
    const staleDays = parseInt(searchParams.get('staleDays') || String(STALE_DAYS_DEFAULT));

    const store = await getOwnerStore();
    const assignments = store.assignments ?? {};

    const rawUsers = await fetchUsers();
    const users: User[] = rawUsers.map(u => ({
      username: u.username,
      name: `${u.lastname}${u.firstname}`,
    }));

    const targetIds = pickTargetIds(store);
    const [raw, coreAssistantStatus, outcomeStatus] = await Promise.all([
      fetchCompletionStatus(),
      fetchCoreAssistantStatus(),
      fetchOutcomeStatus(),
    ]);
    const completionRows = transformCompletion(raw, assignments, users, {
      coreAssistant: coreAssistantStatus,
      outcomeAssistant: outcomeStatus.assistantStatus,
      outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
    });

    const rawLogs = await fetchLogging(months);
    const logs = transformLogs(rawLogs);
    const stats = calcLoggingStats(logs, completionRows, months, assignments, users, targetIds);

    // 「未指派」是無負責人的表單集合，不是成員 —— 抽出來單獨呈現，不混進名單與異常
    const unassigned = stats.byOwner.find(m => m.owner === UNASSIGNED) ?? null;

    // 依完成率由高到低排序，落後者沉底
    const members = stats.byOwner
      .filter(m => m.owner !== UNASSIGNED)
      .sort((a, b) => b.pctComplete - a.pctComplete);

    const isNoEntryThisWeek = (m: OwnerProductivity) =>
      m.daysSince === null || m.daysSince >= WEEK_DAYS;
    const isStale = (m: OwnerProductivity) =>
      m.daysSince !== null && m.daysSince >= staleDays;

    const exceptions = {
      behind: members.filter(m => m.grade === '落後').map(m => m.owner),
      noEntryThisWeek: members.filter(isNoEntryThisWeek).map(m => m.owner),
      stale: members.filter(isStale).map(m => m.owner),
    };

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      periodMonths: months,
      thresholds: { staleDays, weekDays: WEEK_DAYS },
      members,
      unassigned,
      exceptions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
