import { NextRequest, NextResponse } from 'next/server';
import { getLabelers, setLabelers } from '@/lib/labelers';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';

export async function POST(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    if (Array.isArray(body.labelers)) {
      const before = await getLabelers();
      await setLabelers(body.labelers);
      await recordAudit({
        actor: auth.identity.actor,
        action: 'labelers.seed',
        entityType: 'labelers',
        entityId: 'global',
        before,
        after: body.labelers,
      });
      return NextResponse.json({ ok: true, count: body.labelers.length });
    }
    return NextResponse.json({ error: 'labelers array required' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
