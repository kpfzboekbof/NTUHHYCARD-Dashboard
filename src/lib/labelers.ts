import { readFileSync } from 'fs';
import { join } from 'path';
import type { Labeler } from '@/lib/redcap/etiology-transform';

export function getLabelers(): Labeler[] {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'labelers.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
