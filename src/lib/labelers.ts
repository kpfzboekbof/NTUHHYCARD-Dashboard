import type { Labeler } from '@/lib/redcap/etiology-transform';

const REDIS_KEY = 'labelers';
const isVercel = !!process.env.VERCEL;

async function readRedis(): Promise<Labeler[]> {
  let client;
  try {
    const Redis = (await import('ioredis')).default;
    client = new Redis(process.env.REDIS_URL || '', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await client.connect();
    const raw = await client.get(REDIS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  } finally {
    client?.disconnect();
  }
}

function readLocal(): Labeler[] {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const raw = readFileSync(join(process.cwd(), 'data', 'labelers.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Default labelers — used as fallback when Redis and local file are both empty
const DEFAULT_LABELERS: Labeler[] = [
  { code: 0, name: 'Labeler 0' },
  { code: 3, name: 'Labeler 3' },
  { code: 5, name: 'Labeler 5' },
  { code: 6, name: 'Labeler 6' },
  { code: 7, name: 'Labeler 7' },
];

export async function getLabelers(): Promise<Labeler[]> {
  if (isVercel) {
    const data = await readRedis();
    if (data.length > 0) return data;
    return DEFAULT_LABELERS;
  }
  const local = readLocal();
  return local.length > 0 ? local : DEFAULT_LABELERS;
}

export async function setLabelers(labelers: Labeler[]): Promise<void> {
  if (isVercel) {
    let client;
    try {
      const Redis = (await import('ioredis')).default;
      client = new Redis(process.env.REDIS_URL || '', {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      await client.connect();
      await client.set(REDIS_KEY, JSON.stringify(labelers));
    } finally {
      client?.disconnect();
    }
  } else {
    const { writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');
    const dir = join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'labelers.json'), JSON.stringify(labelers, null, 2), 'utf-8');
  }
}
