import { NextRequest, NextResponse } from 'next/server';
import { importEtiologyFinal, batchImportField } from '@/lib/redcap/client';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit, recordAuditMany } from '@/lib/db/audit';
import { invalidateViews, readView, viewPayload } from '@/lib/views/view';
import { etiologyView } from '@/lib/views/etiology';
import { WRITE_EFFECTS } from '@/lib/views/keys';

export const runtime = 'nodejs';
// The background rebuild scheduled by readView runs inside this budget.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get('noCache') === '1';
    const result = await readView(etiologyView, { force });
    return NextResponse.json(viewPayload(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Writing etiology_final back to REDCap is a manager action, and from here
  // on the audit row says which manager.
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    // Batch mode — used by the consensus meeting "auto-fill green" flow.
    if (Array.isArray(body.updates)) {
      const updates = body.updates as Array<{ studyId: string; code: number }>;
      const cleaned = updates.filter(
        u => typeof u?.studyId === 'string' && u.studyId !== '' && Number.isInteger(u?.code),
      );
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'updates 為空或格式不正確' }, { status: 400 });
      }
      const records = cleaned.map(u => ({ study_id: u.studyId, etiology_final: String(u.code) }));
      const { imported, missing } = await batchImportField(records);
      // Only the views this write touches — the etiology view rebuilds before
      // its next answer, the matrix and completion refresh in the background.
      await invalidateViews(WRITE_EFFECTS.etiologyFinal);

      // Audit what REDCap confirmed, one row per record: "who set 5123's
      // etiology_final to 7, and when" is the question this answers.
      const byId = new Map(cleaned.map(u => [u.studyId, u.code]));
      await recordAuditMany(imported.map(studyId => ({
        actor: auth.identity.actor,
        action: 'etiology_final.write',
        entityType: 'record',
        entityId: studyId,
        after: { etiology_final: byId.get(studyId), batch: true },
      })));

      // `imported` is what REDCap confirmed — the client marks only those as saved.
      return NextResponse.json({ ok: true, count: imported.length, imported, missing });
    }

    const { studyId, code } = body as { studyId?: string; code?: number };
    if (!studyId || code === undefined || code === null) {
      return NextResponse.json({ error: '缺少 studyId 或 code 參數' }, { status: 400 });
    }

    await importEtiologyFinal(studyId, code);

    await invalidateViews(WRITE_EFFECTS.etiologyFinal);

    await recordAudit({
      actor: auth.identity.actor,
      action: 'etiology_final.write',
      entityType: 'record',
      entityId: studyId,
      after: { etiology_final: code },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
