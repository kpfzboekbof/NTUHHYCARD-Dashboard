import { defineView, readView, type ViewContext, type ViewDefinition } from './view';
import { DEPENDENTS, VIEW } from './keys';
import { fetchLogging } from '@/lib/redcap/client';
import { transformLogs } from '@/lib/redcap/transform';
import type { LogEntry } from '@/types';

/**
 * REDCap's record log, transformed, one view per look-back window.
 *
 * Read by the productivity page, the QC behaviour checks and the owners'
 * activity columns; the three used to fetch it separately.
 */

const views = new Map<number, ViewDefinition<LogEntry[]>>();

export function redcapLogsView(months: number): ViewDefinition<LogEntry[]> {
  let view = views.get(months);
  if (!view) {
    const key = VIEW.redcapLogs(months);
    view = defineView<LogEntry[]>({
      key,
      freshSeconds: 900,
      exportsFromRedcap: true,
      dependents: DEPENDENTS[key],
      async build() {
        return transformLogs(await fetchLogging(months));
      },
    });
    views.set(months, view);
  }
  return view;
}

/**
 * The log for a window. A failed export is the caller's: for a view whose
 * content IS the log (productivity, QC behaviour checks) an empty log would
 * be persisted as a valid build and served for its whole window.
 */
export async function requireRedcapLogs(months: number, ctx: ViewContext): Promise<LogEntry[]> {
  const { data } = await readView(redcapLogsView(months), { force: ctx.force });
  return data;
}

/**
 * The log for a window, or nothing — only for the owners page, where the
 * log feeds the activity and credit columns and must never cost the progress
 * numbers.
 */
export async function redcapLogs(months: number, ctx: ViewContext): Promise<LogEntry[]> {
  try {
    return await requireRedcapLogs(months, ctx);
  } catch (error) {
    console.error(`views: REDCap log (${months} months) unavailable`, error);
    return [];
  }
}
