import { NextRequest, NextResponse } from 'next/server';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import { getMeetingSettings, updateMeetingSettings } from '@/lib/meeting-store';
import { buildReminderEmail } from '@/lib/email-template';
import { getDataEntryBase } from '@/lib/redcap/deep-link';
import { signRsvp } from '@/lib/rsvp-token';
import { createTransporter, resolveBaseUrl } from '@/lib/mailer';
import { requireRole } from '@/lib/auth/identity';
import { recordAudit } from '@/lib/db/audit';
import type { EtiologyRecord } from '@/lib/redcap/etiology-transform';

/** Filter incomplete records by ID range */
function filterByIdRange(records: EtiologyRecord[], idFrom: number | null, idTo: number | null): EtiologyRecord[] {
  let result = records.filter(r => r.finalCode === null);
  if (idFrom != null) result = result.filter(r => parseInt(r.studyId) >= idFrom);
  if (idTo != null) result = result.filter(r => parseInt(r.studyId) <= idTo);
  return result;
}

/** GET — reminder status: per-labeler incomplete counts + meeting settings */
export async function GET() {
  try {
    const [labelers, rawRows, settings] = await Promise.all([
      getLabelers(),
      fetchEtiologyStatus(),
      getMeetingSettings(),
    ]);

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
      return {
        code: l.code,
        name: l.name,
        email: l.email || null,
        incompleteCount: incompleteCases.length,
        incompleteCaseIds: incompleteCases.map(r => r.studyId),
        rsvp,
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
      const transporter = createTransporter();
      if (!transporter) {
        return NextResponse.json({ error: '未設定 GMAIL_USER 或 GMAIL_APP_PASSWORD 環境變數' }, { status: 500 });
      }

      const fromEmail = process.env.GMAIL_USER!;

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

      const results: Array<{ name: string; email: string; count: number; success: boolean; error?: string }> = [];

      for (const labeler of labelers) {
        if (!labeler.email) continue;
        if (targetCodes && !targetCodes.includes(labeler.code)) continue;

        const incompleteCases = incompleteRecords.filter(
          r => !r.reviewers.find(rev => rev.labelerCode === labeler.code)?.complete,
        );

        // Send the email even when 0 cases remain — the recipient still needs
        // the RSVP buttons. The template switches copy based on the count.

        const { subject, html } = buildReminderEmail(
          labeler.name,
          settings.meetingDate,
          incompleteCases.map(r => r.studyId),
          { from: settings.idFrom, to: settings.idTo },
          {
            baseUrl,
            labelerCode: labeler.code,
            signature: signRsvp(labeler.code, settings.meetingDate),
          },
          redcapBaseUrl,
        );

        try {
          await transporter.sendMail({
            from: fromEmail,
            to: labeler.email,
            subject,
            html,
          });
          results.push({ name: labeler.name, email: labeler.email, count: incompleteCases.length, success: true });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Send failed';
          results.push({ name: labeler.name, email: labeler.email, count: incompleteCases.length, success: false, error: errMsg });
        }
      }

      // Record when reminder was sent. Sending takes seconds, so write just
      // this field back rather than the settings we read before the send loop —
      // an RSVP that arrived meanwhile would otherwise be erased.
      const sentAt = new Date().toISOString();
      await updateMeetingSettings(current => ({ ...current, reminderSentAt: sentAt }));

      await recordAudit({
        actor: auth.identity.actor,
        action: 'reminder.send',
        entityType: 'meeting',
        entityId: settings.meetingDate,
        after: {
          sentAt,
          sent: results.filter(r => r.success).map(r => r.email),
          failed: results.filter(r => !r.success).map(r => r.email),
        },
      });

      return NextResponse.json({ ok: true, results, sentAt });
    }

    return NextResponse.json({ error: '未知的 action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
