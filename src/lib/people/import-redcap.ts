import type { RawUser } from '@/lib/redcap/types';
import type { Person, PersonInput } from './repo';

/**
 * Seeding the person registry from REDCap's own user list.
 *
 * REDCap already knows every abstractor's username, name and email. The
 * dashboard was reading that export and throwing the email away
 * (`api/owners/route.ts:18-21`), which is why there was no way to reach a
 * person except through a hardcoded list — and no login identity at all.
 *
 * The planning step is a pure function so the awkward cases can be tested
 * without a database: someone renamed in REDCap, someone who signed up by
 * email before their REDCap account was linked, and the same email appearing
 * twice in one export.
 */

export interface PlannedCreate {
  input: PersonInput;
}

export interface PlannedUpdate {
  /** The row as it stands, so applying the plan needs no second read. */
  current: Person;
  changes: Partial<PersonInput>;
}

export interface SkippedUser {
  username: string;
  reason: string;
}

export interface ImportPlan {
  create: PlannedCreate[];
  update: PlannedUpdate[];
  skipped: SkippedUser[];
}

/** REDCap stores the family name and given name separately; display them joined. */
export function displayNameOf(user: RawUser): string {
  const joined = `${user.lastname ?? ''}${user.firstname ?? ''}`.trim();
  return joined || user.username;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Works out what the import would do, without doing it.
 *
 * Matching is by REDCap username first and email second, so a person who has
 * already logged in by email gets their REDCap account linked to the row they
 * already have, rather than a second row that splits their history in two.
 */
export function planImport(users: RawUser[], existing: Person[]): ImportPlan {
  const byUsername = new Map<string, Person>();
  const byEmail = new Map<string, Person>();
  for (const person of existing) {
    if (person.redcapUsername) byUsername.set(person.redcapUsername, person);
    byEmail.set(normalizeEmail(person.email), person);
  }

  const plan: ImportPlan = { create: [], update: [], skipped: [] };
  // Two REDCap accounts sharing one mailbox would collide on person.email;
  // the first wins and the second is reported rather than silently dropped.
  const claimedEmails = new Set<string>();

  for (const user of users) {
    const username = (user.username ?? '').trim();
    if (!username) continue;

    const email = (user.email ?? '').trim();
    if (!email) {
      plan.skipped.push({ username, reason: 'REDCap 沒有 email，無法作為登入身分' });
      continue;
    }
    const key = normalizeEmail(email);
    const displayName = displayNameOf(user);

    const byName = byUsername.get(username);
    if (byName) {
      const changes: Partial<PersonInput> = {};
      if (byName.displayName !== displayName) changes.displayName = displayName;
      if (normalizeEmail(byName.email) !== key) changes.email = email;
      if (Object.keys(changes).length > 0) {
        plan.update.push({ current: byName, changes });
      }
      claimedEmails.add(key);
      continue;
    }

    const byMail = byEmail.get(key);
    if (byMail) {
      if (byMail.redcapUsername && byMail.redcapUsername !== username) {
        plan.skipped.push({
          username,
          reason: `email ${email} 已屬於 REDCap 帳號 ${byMail.redcapUsername}`,
        });
        continue;
      }
      plan.update.push({
        current: byMail,
        changes: { redcapUsername: username, displayName },
      });
      claimedEmails.add(key);
      continue;
    }

    if (claimedEmails.has(key)) {
      plan.skipped.push({ username, reason: `email ${email} 在這次匯入中重複` });
      continue;
    }
    claimedEmails.add(key);

    // Roles start at viewer for everyone. Who may approve, write back or
    // manage is a decision for a manager on the people page, not something to
    // infer from a REDCap account existing.
    plan.create.push({
      input: { redcapUsername: username, displayName, email, roles: ['viewer'] },
    });
  }

  return plan;
}
