/**
 * Shared REDCap data assembly used by multiple API routes.
 *
 * The users fetch+cache and the completion-row pipeline used to be copied
 * into /api/completion, /api/logging, /api/qc, /api/owners and
 * /api/report/weekly — this module is the single copy. Trauma-eligibility
 * filtering is always applied so every consumer sees the same rows as the
 * completion dashboard (the copied fallbacks used to skip it).
 */

import { getCachedAsync, setCached } from '@/lib/cache';
import {
  fetchUsers, fetchCompletionStatus, fetchCoreAssistantStatus,
  fetchOutcomeStatus, fetchTraumaEligibleIds,
} from './client';
import { transformCompletion } from './transform';
import type { CompletionResponse, CompletionRow, OwnerAssignments, User } from '@/types';

const USERS_CACHE_KEY = 'redcap_users';

/** REDCap users (username + display name), cached for 30 minutes. */
export async function getUsers(): Promise<User[]> {
  const cached = await getCachedAsync<User[]>(USERS_CACHE_KEY);
  if (cached) return cached;

  const raw = await fetchUsers();
  const users: User[] = raw.map(u => ({
    username: u.username,
    name: `${u.lastname}${u.firstname}`,
  }));

  setCached(USERS_CACHE_KEY, users, 1800);
  return users;
}

/** Fetch everything needed from REDCap and build the completion rows. */
export async function buildCompletionRows(
  assignments: OwnerAssignments,
  users: User[],
): Promise<CompletionRow[]> {
  const [raw, coreAssistantStatus, outcomeStatus, traumaIds] = await Promise.all([
    fetchCompletionStatus(),
    fetchCoreAssistantStatus(),
    fetchOutcomeStatus(),
    fetchTraumaEligibleIds(),
  ]);
  return transformCompletion(raw, assignments, users, {
    coreAssistant: coreAssistantStatus,
    outcomeAssistant: outcomeStatus.assistantStatus,
    outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
  }, traumaIds);
}

/** Completion rows, reusing the /api/completion cache entry when present. */
export async function getCompletionRowsCached(
  assignments: OwnerAssignments,
  users: User[],
): Promise<CompletionRow[]> {
  const cached = await getCachedAsync<CompletionResponse>('completion');
  return cached?.rows ?? buildCompletionRows(assignments, users);
}
