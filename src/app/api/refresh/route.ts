import { NextResponse } from 'next/server';
import { clearAllCache } from '@/lib/cache';

export async function POST() {
  clearAllCache();
  return NextResponse.json({ ok: true, message: '快取已清除' });
}
