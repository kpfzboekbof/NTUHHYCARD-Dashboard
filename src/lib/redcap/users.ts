import { getCachedAsync, setCached } from '@/lib/cache';
import { fetchUsers } from './client';
import type { User } from '@/types';

/**
 * REDCap's user list as {username, name}, cached for half an hour.
 *
 * Five routes carried their own copy of this lookup; a directory that changes
 * a few times a year deserves one.
 */

const CACHE_KEY = 'redcap_users';
const CACHE_TTL_SECONDS = 1800;

/** `force` re-reads REDCap — the 重新抓取 button means everything on the page. */
export async function getRedcapUsers(force = false): Promise<User[]> {
  const cached = force ? undefined : await getCachedAsync<User[]>(CACHE_KEY);
  if (cached) return cached;

  const raw = await fetchUsers();
  const users: User[] = raw.map(u => ({
    username: u.username,
    name: `${u.lastname ?? ''}${u.firstname ?? ''}`,
  }));
  setCached(CACHE_KEY, users, CACHE_TTL_SECONDS);
  return users;
}
