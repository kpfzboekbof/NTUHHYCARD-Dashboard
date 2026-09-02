import { requireRole } from './identity';
import type { CronTrigger } from '@/lib/db/cron-runs';

/**
 * Who may hit a /api/cron/* route: the scheduler carrying CRON_SECRET
 * (Vercel sends it as a Bearer token), or a signed-in manager triggering the
 * same work by hand. With no CRON_SECRET configured only the manager path
 * works — a deployment must not expose an unauthenticated trigger by default.
 *
 * The result says *which* path let the caller in, because the run ledger needs
 * it: a job that only ever succeeds when somebody presses the button is a job
 * whose schedule is broken, and one number for both hides exactly that.
 */
export type CronAuth =
  | { ok: false }
  | { ok: true; trigger: CronTrigger; actor: string | null };

export async function authorizeCron(request: Request): Promise<CronAuth> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('authorization');
    if (header === `Bearer ${secret}`) return { ok: true, trigger: 'schedule', actor: null };
  }
  const auth = await requireRole('manager');
  // A manual run on the shared admin password names nobody; the ledger records
  // it as manual with no actor rather than inventing one.
  return auth.ok ? { ok: true, trigger: 'manual', actor: auth.identity.personId } : { ok: false };
}
