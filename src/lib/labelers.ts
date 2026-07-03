import { createJsonStore } from './kv-store';
import type { Labeler } from '@/lib/redcap/etiology-transform';

// Default labelers — used as fallback when Redis and local file are both empty
const DEFAULT_LABELERS: Labeler[] = [
  { code: 0, name: 'Labeler 0' },
  { code: 3, name: 'Labeler 3' },
  { code: 5, name: 'Labeler 5' },
  { code: 6, name: 'Labeler 6' },
  { code: 7, name: 'Labeler 7' },
];

const store = createJsonStore<Labeler[]>({
  redisKey: 'labelers',
  localFile: 'labelers.json',
  fallback: () => [],
});

export async function getLabelers(): Promise<Labeler[]> {
  const data = await store.read();
  return data.length > 0 ? data : DEFAULT_LABELERS;
}

export async function setLabelers(labelers: Labeler[]): Promise<void> {
  return store.write(labelers);
}
