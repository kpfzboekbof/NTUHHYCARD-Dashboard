'use client';

import { useCallback, useState } from 'react';

/**
 * A polling interval that tightens while the server says a rebuild is running.
 *
 * Every heavy API answers from its last build and refreshes behind the
 * response; `refreshing: true` in the body means a newer build is on its way.
 * Polling every fifteen seconds then shows it without a click, and the usual
 * five-minute cadence resumes once it has landed.
 *
 * The interval is state, not a function passed to SWR: SWR only re-reads a
 * function interval when a timer fires, so a five-minute timer armed before
 * the first response would ignore `refreshing` until it ran out. A changed
 * number re-arms the timer at once.
 *
 * Usage: `const [interval, track] = useAdaptiveInterval(300_000)` before the
 * SWR call, then `track(data?.refreshing)` from an effect on the response.
 */
export function useAdaptiveInterval(normalMs: number, fastMs = 15_000): [number, (refreshing: boolean | undefined) => void] {
  const [fast, setFast] = useState(false);
  const track = useCallback((refreshing: boolean | undefined) => setFast(!!refreshing), []);
  return [fast ? fastMs : normalMs, track];
}
