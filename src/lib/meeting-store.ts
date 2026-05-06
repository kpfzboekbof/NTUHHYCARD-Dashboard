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

const REDIS_KEY = 'meeting-settings';
const isVercel = !!process.env.VERCEL;

function emptySettings(): MeetingSettings {
  return { meetingDate: null, idFrom: null, idTo: null, reminderSentAt: null, rsvps: {} };
}

function normalize(raw: unknown): MeetingSettings {
  const base = emptySettings();
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
  return base;
}

async function readRedis(): Promise<MeetingSettings> {
  let client;
  try {
    const Redis = (await import('ioredis')).default;
    client = new Redis(process.env.REDIS_URL || '', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await client.connect();
    const raw = await client.get(REDIS_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return emptySettings();
  } finally {
    client?.disconnect();
  }
}

async function writeRedis(data: MeetingSettings): Promise<void> {
  let client;
  try {
    const Redis = (await import('ioredis')).default;
    client = new Redis(process.env.REDIS_URL || '', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await client.connect();
    await client.set(REDIS_KEY, JSON.stringify(data));
  } finally {
    client?.disconnect();
  }
}

function readLocal(): MeetingSettings {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const raw = readFileSync(join(process.cwd(), 'data', 'meeting-settings.json'), 'utf-8');
    return normalize(JSON.parse(raw));
  } catch {
    return emptySettings();
  }
}

function writeLocal(data: MeetingSettings): void {
  const { writeFileSync, mkdirSync } = require('fs');
  const { join } = require('path');
  const dir = join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meeting-settings.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export async function getMeetingSettings(): Promise<MeetingSettings> {
  return isVercel ? readRedis() : readLocal();
}

export async function setMeetingSettings(settings: MeetingSettings): Promise<void> {
  return isVercel ? writeRedis(settings) : writeLocal(settings);
}
