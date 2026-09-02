import { NextRequest, NextResponse } from 'next/server';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import { getMeetingSettings, updateMeetingSettings } from '@/lib/meeting-store';
import { buildReminderEmail } from '@/lib/email-template';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { signRsvp } from '@/lib/rsvp-token';
import { resolveBaseUrl } from '@/lib/mailer';
import { sendTrackedMail } from '@/lib/mail/send';
import { resolveLabelerTargets } from '@/lib/people/labeler-targets';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';
import { lastReminderByLabelerCode } from '@/lib/db/outbound-mail';
import type { EtiologyRecord } from '@/lib/redcap/etiology-transform';

/** Filter incomplete records by ID range */
function filterByIdRange(records: EtiologyRecord[], idFrom: number | null, idTo: number | null): EtiologyRecord[] {
  let result = records.filter(r => r.finalCode === null);
  if (idFrom != null) result = result.filter(r => parseInt(r.studyId) >= idFrom);
  if (idTo != null) result = result.filter(r => parseInt(r.studyId) <= idTo);
  return result;
}

/**
 * GET — reminder status: per-labeler incomplete counts + meeting settings.
 *
 * Manager-only: it carries the addresses a reminder would go to and the
 * registry rows behind them.
 */
export async function GET() {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const [labelers, rawRows, settings, lastReminder] = await Promise.all([
      getLabelers(),
      fetchEtiologyStatus(),
      getMeetingSettings(),
      lastReminderByLabelerCode().catch(() => ({} as Record<string, string>)),
    ]);

    // The same resolution the send performs, so the address shown here and the
    // address a reminder actually leaves for cannot disagree.
    const targetByCode = new Map(
      (await resolveLabelerTargets(labelers)).map(target => [target.code, target]),
    );

    const { records } = transformEtiology(rawRows, labelers);
    const incompleteRecords = filterByIdRange(records, settings.idFrom, settings.idTo);

    const labelerStatus = labelers.map(l => {
      const incompleteCases = incompleteRecords.filter(
        r => !r.reviewers.find(rev => rev.labelerCode === l.code)?.complete,
      );
      // Only surface RSVPs that match the currently configured meeting date —
      // a stale entry from a previous meeting should appear as "no response".
      const stored = settings.rsvps[String(l.code)];
      const rsvp = stored && settings.meetingDate && stored.meetingDate === settings.meetingDate
        ? { response: stored.response, respondedAt: stored.respondedAt }
        : null;
      const target = targetByCode.get(l.code);
      return {
        code: l.code,
        name: target?.name ?? l.name,
        email: target?.email ?? null,
        /** Set when a registry person carries this labeler code. */
        personId: target?.personId ?? null,
        /** True when the address came from the registry, not the labeler store. */
        fromRegistry: target?.fromRegistry ?? false,
        incompleteCount: incompleteCases.length,
        incompleteCaseIds: incompleteCases.map(r => r.studyId),
        rsvp,
        // When this labeler was last actually reminded, from the mail ledger.
        lastReminderAt: lastReminder[String(l.code)] ?? null,
      };
    });

    return NextResponse.json({
      labelerStatus,
      meetingDate: settings.meetingDate,
      idFrom: settings.idFrom,
      idTo: settings.idTo,
      reminderSentAt: settings.reminderSentAt,
      totalIncompleteRecords: incompleteRecords.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — send reminder emails or update meeting settings */
export async function POST(request: NextRequest) {
  const auth = await requireRole('manager');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    // Update meeting settings (date + ID range)
    if (body.action === 'updateSettings') {
      const before = await getMeetingSettings();
      const settings = await updateMeetingSettings(current => ({
        ...current,
        meetingDate: 'meetingDate' in body ? (body.meetingDate || null) : current.meetingDate,
        idFrom: 'idFrom' in body ? (body.idFrom ?? null) : current.idFrom,
        idTo: 'idTo' in body ? (body.idTo ?? null) : current.idTo,
      }));
      await recordAudit({
        actor: auth.identity.actor,
        action: 'meeting_settings.update',
        entityType: 'meeting',
        entityId: settings.meetingDate ?? 'unset',
        before,
        after: settings,
      });
      return NextResponse.json({ ok: true, ...settings });
    }

    // Send reminder emails
    if (body.action === 'sendReminder') {
      const [labelers, rawRows, settings] = await Promise.all([
        getLabelers(),
        fetchEtiologyStatus(),
        getMeetingSettings(),
      ]);

      if (!settings.meetingDate) {
        return NextResponse.json({ error: '請先設定共識會議日期' }, { status: 400 });
      }

      const { records } = transformEtiology(rawRows, labelers);
      const incompleteRecords = filterByIdRange(records, settings.idFrom, settings.idTo);

      const baseUrl = await resolveBaseUrl();
      const redcapBaseUrl = await getDataEntryBase();

      // Optional: only send to specific labeler codes
      const targetCodes: number[] | undefined = body.labelerCodes;

      // The registry's email wins over the copy stored beside the labeler code;
      // until a code is linked in /admin/people the old address still works.
      const targets = await resolveLabelerTargets(labelers);

      const results: Array<{ name: string; email: string; count: number; success: boolean; error?: string }> = [];

      for (const target of targets) {
        if (!target.email) continue;
        if (targetCodes && !targetCodes.includes(target.code)) continue;

        const incompleteCases = incompleteRecords.filter(
          r => !r.reviewers.find(rev => rev.labelerCode === target.code)?.complete,
        );

        // Send the email even when 0 cases remain — the recipient still needs
        // the RSVP buttons. The template switches copy based on the count.

        const { subject, html } = buildReminderEmail(
          target.name,
          settings.meetingDate,
          incompleteCases.map(r => r.studyId),
          { from: settings.idFrom, to: settings.idTo },
          {
            baseUrl,
            labelerCode: target.code,
            signature: signRsvp(target.code, settings.meetingDate),
          },
          redcapBaseUrl,
        );

        const result = await sendTrackedMail({
          toPersonId: target.personId,
          toEmail: target.email,
          kind: 'meeting_reminder',
          subject,
          html,
          // labelerCode is in the payload so per-labeler reminder history is
          // answerable even for codes with no person row to key on.
          payload: {
            meetingDate: settings.meetingDate,
            labelerCode: target.code,
            incomplete: incompleteCases.length,
            idRange: { from: settings.idFrom, to: settings.idTo },
          },
          requestedBy: auth.identity.personId,
        });

        results.push({
          name: target.name,
          email: target.email,
          count: incompleteCases.length,
          success: result.ok,
          ...(result.error ? { error: result.error } : {}),
        });
      }

      // Only claim a reminder went out when one actually did. The old code set
      // this unconditionally, so a run where every send failed still read as
      // "reminded" — the single global timestamp that made failure invisible.
      const anySent = results.some(r => r.success);
      const sentAt = new Date().toISOString();
      if (anySent) {
        // Written as just this field rather than the settings read before the
        // loop: an RSVP that arrived meanwhile would otherwise be erased.
        await updateMeetingSettings(current => ({ ...current, reminderSentAt: sentAt }));
      }

      await recordAudit({
        actor: auth.identity.actor,
        action: 'reminder.send',
        entityType: 'meeting',
        entityId: settings.meetingDate,
        after: {
          sentAt: anySent ? sentAt : null,
          sent: results.filter(r => r.success).map(r => r.email),
          failed: results.filter(r => !r.success).map(r => ({ email: r.email, error: r.error })),
        },
      });

      return NextResponse.json({
        ok: anySent,
        results,
        sentAt: anySent ? sentAt : null,
        ...(anySent ? {} : { error: '所有提醒信都寄送失敗，未更新提醒時間' }),
      });
    }

    return NextResponse.json({ error: '未知的 action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
