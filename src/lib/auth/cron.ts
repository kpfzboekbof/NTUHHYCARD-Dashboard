import { requireRole } from './identity';

/**
 * Who may hit a /api/cron/* route: the scheduler carrying CRON_SECRET
 * (Vercel sends it as a Bearer token), or a signed-in manager triggering the
 * same work by hand. With no CRON_SECRET configured only the manager path
 * works — a deployment must not expose an unauthenticated trigger by default.
 */
export async function authorizeCron(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('authorization');
    if (header === `Bearer ${secret}`) return true;
  }
  const auth = await requireRole('manager');
  return auth.ok;
}
