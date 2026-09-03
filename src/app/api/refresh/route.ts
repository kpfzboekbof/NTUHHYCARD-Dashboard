import { NextResponse } from 'next/server';
import { clearAllCache } from '@/lib/cache';
import { invalidateViews } from '@/lib/views/view';
import { allViewKeys } from '@/lib/views/keys';

/**
 * POST /api/refresh — everything derived is now suspect.
 *
 * Called by /assign after settings are saved. The views are marked rather
 * than deleted: each keeps answering from its last build and rebuilds behind
 * the response (the etiology view, before its next answer). The small
 * caches — REDCap users, the deep-link base — are simply dropped.
 */
export async function POST() {
  clearAllCache();
  await invalidateViews(allViewKeys());
  return NextResponse.json({ ok: true, message: '快取已標記為過期，各頁面將在背景重新推導' });
}
