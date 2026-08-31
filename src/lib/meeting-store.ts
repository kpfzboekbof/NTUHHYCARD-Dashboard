import { createVersionedStore } from '@/lib/store/versioned-store';

export type RsvpResponse = 'yes' | 'no';

export interface RsvpEntry {
  response: RsvpResponse;
  respondedAt: string;       // ISO datetime
  meetingDate: string;       // ISO date the RSVP refers to
}

export interface MeetingSettings {
  meetingDate: string | null;       // ISO date string (YYYY-MM-DD)
  idFrom: number | null;            // Study ID range start (inclusive)
  idTo: number | null;              // Study ID range end (inclusive)
  reminderSentAt: string | null;    // ISO datetime of last reminder sent
  rsvps: Record<string, RsvpEntry>; // labelerCode (string) → RSVP entry
}

function emptySettings(): MeetingSettings {
  return { meetingDate: null, idFrom: null, idTo: null, reminderSentAt: null, rsvps: {} };
}

function normalize(raw: unknown): MeetingSettings {
  if (!raw || typeof raw !== 'object') return emptySettings();
  const stored = raw as Partial<MeetingSettings>;
  return {
    meetingDate: stored.meetingDate ?? null,
    idFrom: stored.idFrom ?? null,
    idTo: stored.idTo ?? null,
    reminderSentAt: stored.reminderSentAt ?? null,
    rsvps: stored.rsvps ?? {},
  };
}

const store = createVersionedStore<MeetingSettings>({
  redisKey: 'meeting-settings',
  localFile: 'meeting-settings.json',
  normalize,
});

export async function getMeetingSettings(): Promise<MeetingSettings> {
  return (await store.read()).data;
}

/**
 * Replace the whole settings blob.
 *
 * Prefer `updateMeetingSettings` where the caller only changes one field: a
 * transient read failure used to hand the caller empty settings, which this
 * function would then write back over a live meeting.
 */
export async function setMeetingSettings(settings: MeetingSettings): Promise<void> {
  await store.update(() => settings);
}

/** Read-modify-write one part of the settings, retried against fresh data. */
export async function updateMeetingSettings(
  mutate: (current: MeetingSettings) => MeetingSettings,
): Promise<MeetingSettings> {
  return (await store.update(mutate)).data;
}
