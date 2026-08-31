import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/identity';
import { hasDatabase } from '@/lib/db/client';
import { listBatches, createBatch, updateBatch, findBatch } from '@/lib/db/batches';
import { loadBacklog } from '@/lib/state/backlog-source';
import { lastNudgeByPerson } from '@/lib/db/outbound-mail';
import { recordAudit } from '@/lib/db/audit';

/**
 * Batches — manager only.
 *
 * A batch is "everything up to study id N, done by date D". GET returns each
 * open batch with its live per-person shortfall, which is the whole point: the
 * operator opens this page to see who is behind on what, and mails them.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

function noDatabase() {
  return NextResponse.json(
    { error: '未設定 OHCA_DATABASE_URL：批次功能無法使用' },
    { status: 503 },
  );
}

/** YYYY-MM-DD, or null. Anything else is a mistake worth reporting. */
function parseDueDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const params = request.nextUrl.searchParams;
    const includeClosed = params.get('includeClosed') === '1';
    const batches = await listBatches(includeClosed);

    // Without progress this page would only echo back what was typed in.
    const withProgress = await Promise.all(batches.map(async batch => {
      if (batch.closedAt) return { ...batch, backlog: [], total: 0, fetchedAt: null };
      const { backlog, fetchedAt } = await loadBacklog({
        studyIdCutoff: batch.studyIdCutoff,
        unitIds: batch.unitIds,
      });
      return {
        ...batch,
        backlog,
        total: backlog.reduce((n, p) => n + p.total, 0),
        fetchedAt,
      };
    }));

    const lastNudge = await lastNudgeByPerson();
    const { units } = await loadBacklog({ studyIdCutoff: 0 });

    return NextResponse.json({
      batches: withProgress,
      units,
      lastNudge: Object.fromEntries(lastNudge),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const studyIdCutoff = Number(body.studyIdCutoff);
    const dueDate = parseDueDate(body.dueDate);

    if (!name) return NextResponse.json({ error: '批次名稱為必填' }, { status: 400 });
    if (!Number.isInteger(studyIdCutoff) || studyIdCutoff <= 0) {
      return NextResponse.json({ error: '收案編號上限必須是正整數' }, { status: 400 });
    }
    if (dueDate === undefined && body.dueDate !== undefined) {
      return NextResponse.json({ error: '截止日格式須為 YYYY-MM-DD' }, { status: 400 });
    }

    const batch = await createBatch({
      name,
      studyIdCutoff,
      dueDate: dueDate ?? null,
      unitIds: Array.isArray(body.unitIds) ? body.unitIds.filter((u: unknown) => typeof u === 'string') : [],
    }, auth.identity.personId);

    await recordAudit({
      actor: auth.identity.actor,
      action: 'batch.create',
      entityType: 'batch',
      entityId: batch.id,
      after: batch,
    });

    return NextResponse.json({ batch });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;
  if (!hasDatabase()) return noDatabase();

  try {
    const body = await request.json();
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const before = await findBatch(body.id);
    if (!before) return NextResponse.json({ error: '找不到批次' }, { status: 404 });

    const dueDate = parseDueDate(body.dueDate);
    if (dueDate === undefined && body.dueDate !== undefined) {
      return NextResponse.json({ error: '截止日格式須為 YYYY-MM-DD' }, { status: 400 });
    }

    const batch = await updateBatch(body.id, {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      studyIdCutoff: Number.isInteger(body.studyIdCutoff) && body.studyIdCutoff > 0 ? body.studyIdCutoff : undefined,
      ...(dueDate !== undefined ? { dueDate } : {}),
      unitIds: Array.isArray(body.unitIds) ? body.unitIds : undefined,
      closed: typeof body.closed === 'boolean' ? body.closed : undefined,
    });

    await recordAudit({
      actor: auth.identity.actor,
      action: 'batch.update',
      entityType: 'batch',
      entityId: body.id,
      before,
      after: batch,
    });

    return NextResponse.json({ batch });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
