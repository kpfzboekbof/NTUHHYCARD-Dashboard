import { createJsonStore } from './kv-store';

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
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<MeetingSettings>;
    return {
      meetingDate: r.meetingDate ?? null,
      idFrom: r.idFrom ?? null,
      idTo: r.idTo ?? null,
      reminderSentAt: r.reminderSentAt ?? null,
      rsvps: r.rsvps ?? {},
    };
  }
  return emptySettings();
}

const store = createJsonStore<MeetingSettings>({
  redisKey: 'meeting-settings',
  localFile: 'meeting-settings.json',
  fallback: emptySettings,
  normalize,
});

export async function getMeetingSettings(): Promise<MeetingSettings> {
  return store.read();
}

export async function setMeetingSettings(settings: MeetingSettings): Promise<void> {
  return store.write(settings);
}
