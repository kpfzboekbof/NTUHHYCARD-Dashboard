import type { Labeler } from '@/lib/redcap/etiology-transform';
import { createVersionedStore } from '@/lib/store/versioned-store';

// Default labelers — used as fallback when the store has never been seeded.
// The code gaps (no 1, 2, 4) mirror the codes actually in use in REDCap's
// etiology `labeler` dropdown.
const DEFAULT_LABELERS: Labeler[] = [
  { code: 0, name: 'Labeler 0' },
  { code: 3, name: 'Labeler 3' },
  { code: 5, name: 'Labeler 5' },
  { code: 6, name: 'Labeler 6' },
  { code: 7, name: 'Labeler 7' },
];

function normalize(raw: unknown): Labeler[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Labeler =>
      !!entry && typeof entry === 'object' &&
      typeof (entry as Labeler).code === 'number' &&
      typeof (entry as Labeler).name === 'string',
  );
}

const store = createVersionedStore<Labeler[]>({
  redisKey: 'labelers',
  localFile: 'labelers.json',
  normalize,
});

export async function getLabelers(): Promise<Labeler[]> {
  const { data } = await store.read();
  return data.length > 0 ? data : DEFAULT_LABELERS;
}

export async function setLabelers(labelers: Labeler[]): Promise<void> {
  await store.update(() => labelers);
}
