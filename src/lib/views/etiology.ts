import { defineView } from './view';
import { VIEW } from './keys';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { transformEtiology, type EtiologyResponse } from '@/lib/redcap/etiology-transform';

/**
 * The etiology review view behind /etiology and the consensus meeting.
 *
 * `onInvalidate: 'rebuild'`: the meeting writes etiology_final and then reads
 * this view back, so after a write the next read waits for a fresh export
 * (one request, ~10 s) rather than risk showing the record it just handled
 * as still open. Every other view may be served stale; this one, after a
 * write, may not.
 */
export const etiologyView = defineView<EtiologyResponse>({
  key: VIEW.etiology,
  freshSeconds: 300,
  onInvalidate: 'rebuild',
  exportsFromRedcap: true,

  async build(ctx) {
    const labelers = await getLabelers();
    const rawRows = await fetchEtiologyStatus();
    const { records, stats } = transformEtiology(rawRows, labelers);

    return {
      records,
      stats,
      labelers,
      redcapBaseUrl: await getDataEntryBase(ctx.force),
      fetchedAt: new Date().toISOString(),
    };
  },
});
