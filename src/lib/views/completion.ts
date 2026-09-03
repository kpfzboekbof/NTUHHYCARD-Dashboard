import { defineView, readView, type ViewContext } from './view';
import { DEPENDENTS, VIEW } from './keys';
import {
  fetchCompletionStatus, fetchCoreAssistantStatus, fetchOutcomeStatus, fetchTraumaEligibleIds,
} from '@/lib/redcap/client';
import { getRedcapUsers } from '@/lib/redcap/users';
import { readOwnerStore } from '@/lib/owner-store';
import { transformCompletion, calcFormStats, calcOwnerStats } from '@/lib/redcap/transform';
import { packCompletion, unpackCompletion } from '@/lib/redcap/completion-codec';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import type { CompletionPayload, CompletionRow } from '@/types';

/**
 * The legacy completion view: per (record × form) 0/1/2, behind /dashboard,
 * /heatmap, /assign and the productivity numbers.
 *
 * Four REDCap exports, so a build is tens of seconds; served from the last
 * build and refreshed behind the response like every other view.
 */
export const completionView = defineView<CompletionPayload>({
  key: VIEW.completion,
  freshSeconds: 600,
  exportsFromRedcap: true,
  dependents: DEPENDENTS[VIEW.completion],

  async build(ctx) {
    const [{ assignments, hiddenForms, targetIds }, users] = await Promise.all([
      readOwnerStore(),
      getRedcapUsers(ctx.force),
    ]);

    const [raw, coreAssistantStatus, outcomeStatus, traumaIds] = await Promise.all([
      fetchCompletionStatus(),
      fetchCoreAssistantStatus(),
      fetchOutcomeStatus(),
      fetchTraumaEligibleIds(),
    ]);
    const rows = transformCompletion(raw, assignments, users, {
      coreAssistant: coreAssistantStatus,
      outcomeAssistant: outcomeStatus.assistantStatus,
      outcomeEtiologyFinal: outcomeStatus.etiologyFinalStatus,
    }, traumaIds);
    const visibleRows = rows.filter(r => !hiddenForms.includes(r.form));

    // Count unique study IDs
    const allStudyIds = new Set(rows.map(r => r.studyId));
    const validStudyIds = new Set(rows.filter(r => !r.excluded).map(r => r.studyId));

    return {
      packed: packCompletion(visibleRows),
      byForm: calcFormStats(visibleRows),
      byOwner: calcOwnerStats(visibleRows),
      users,
      assignments,
      hiddenForms,
      targetIds,
      totalRecords: allStudyIds.size,
      validOhcaCount: validStudyIds.size,
      redcapBaseUrl: await getDataEntryBase(ctx.force),
      fetchedAt: new Date().toISOString(),
    };
  },
});

/** The visible completion rows, for the views built on top of this one. */
export async function completionRows(ctx: ViewContext): Promise<CompletionRow[]> {
  const { data } = await readView(completionView, { force: ctx.force });
  return unpackCompletion(data.packed);
}
