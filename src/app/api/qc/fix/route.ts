import { NextRequest, NextResponse } from 'next/server';
import { fetchQcRecords, batchImportField } from '@/lib/redcap/client';
import { invalidateViews } from '@/lib/views/view';
import { WRITE_EFFECTS } from '@/lib/views/keys';
import { requireRole } from '@/lib/auth/identity';
import { recordAuditMany } from '@/lib/db/audit';

/**
 * POST /api/qc/fix
 * Body: { checkId: string }
 *
 * Batch-fix known QC issues by importing corrected values into REDCap.
 *
 * This route had no authorization of its own: the site-wide proxy asks for the
 * shared user password, and everyone who knows it could batch-write to the
 * production REDCap project. It is a manager action now, and audited per
 * record REDCap confirms.
 */

type FixResult = { updated: number; studyIds: string[]; missing: string[] };

const FIX_HANDLERS: Record<string, (rows: Record<string, string>[]) => { records: Array<{ study_id: string; [k: string]: string }>; studyIds: string[] }> = {
  // B1: prehos_rosc_core=1 but ever_rosc=0 → set ever_rosc=1
  B1: (rows) => {
    const targets = rows.filter(r => {
      if (!r.study_id) return false;
      if (r.redcap_repeat_instrument && r.redcap_repeat_instrument !== '') return false;
      if (r.exclusion && r.exclusion !== '' && r.exclusion !== '0') return false;
      return r.prehos_rosc_core === '1' && r.ever_rosc === '0';
    });
    return {
      records: targets.map(r => ({ study_id: r.study_id, ever_rosc: '1' })),
      studyIds: targets.map(r => r.study_id),
    };
  },
};

export async function POST(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const checkId = body?.checkId as string;

    if (!checkId || !FIX_HANDLERS[checkId]) {
      const supported = Object.keys(FIX_HANDLERS).join(', ');
      return NextResponse.json(
        { error: `Unsupported checkId. Supported: ${supported}` },
        { status: 400 },
      );
    }

    const qcRows = await fetchQcRecords();
    const { records } = FIX_HANDLERS[checkId](qcRows);

    if (records.length === 0) {
      return NextResponse.json({ updated: 0, studyIds: [], missing: [] } satisfies FixResult);
    }

    // Report the records REDCap confirmed, not the ones we asked it to write.
    const { imported, missing } = await batchImportField(records);
    await invalidateViews(WRITE_EFFECTS.qcFix);

    await recordAuditMany(imported.map(studyId => ({
      actor: auth.identity.actor,
      action: 'qc_fix.apply',
      entityType: 'record',
      entityId: studyId,
      after: { checkId },
    })));

    return NextResponse.json({
      updated: imported.length,
      studyIds: imported,
      missing,
    } satisfies FixResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
