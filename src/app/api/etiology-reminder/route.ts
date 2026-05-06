import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import * as nodemailer from 'nodemailer';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import { getMeetingSettings, setMeetingSettings } from '@/lib/meeting-store';
import { buildReminderEmail } from '@/lib/email-template';
import { signRsvp } from '@/lib/rsvp-token';
import type { EtiologyRecord } from '@/lib/redcap/etiology-transform';

function generateAdminToken(): string {
  const adminPw = process.env.ADMIN_PASSWORD || '';
  const data = `${adminPw}-ohca-admin-salt`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function verifyAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  const expected = generateAdminToken();
  const adminPw = process.env.ADMIN_PASSWORD || '';
  return !!(adminPw && token && token === expected);
}

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/** Filter incomplete records by ID range */
function filterByIdRange(records: EtiologyRecord[], idFrom: number | null, idTo: number | null): EtiologyRecord[] {
  let result = records.filter(r => r.finalCode === null);
  if (idFrom != null) result = result.filter(r => parseInt(r.studyId) >= idFrom);
  if (idTo != null) result = result.filter(r => parseInt(r.studyId) <= idTo);
  return result;
}

/** Resolve the public base URL used to build links inside emails. */
async function resolveBaseUrl(): Promise<string> {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  // Fall back to the inbound request's host so dev and self-hosted setups
  // still produce a clickable link.
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    const proto = h.get('x-forwarded-proto') || 'http';
    if (host) return `${proto}://${host}`;
  } catch {}
  return 'http://localhost:3000';
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
  try {
    if (!(await verifyAdmin())) {
      return NextResponse.json({ error: '未授權，請先以管理員身份登入' }, { status: 401 });
    }

    const body = await request.json();

    // Update meeting settings (date + ID range)
    if (body.action === 'updateSettings') {
      const settings = await getMeetingSettings();
      if ('meetingDate' in body) settings.meetingDate = body.meetingDate || null;
      if ('idFrom' in body) settings.idFrom = body.idFrom ?? null;
      if ('idTo' in body) settings.idTo = body.idTo ?? null;
      await setMeetingSettings(settings);
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

      // Optional: only send to specific labeler codes
      const targetCodes: number[] | undefined = body.labelerCodes;

      const results: Array<{ name: string; email: string; count: number; success: boolean; error?: string }> = [];

      for (const labeler of labelers) {
        if (!labeler.email) continue;
        if (targetCodes && !targetCodes.includes(labeler.code)) continue;

        const incompleteCases = incompleteRecords.filter(
          r => !r.reviewers.find(rev => rev.labelerCode === labeler.code)?.complete,
        );

        if (incompleteCases.length === 0) {
          results.push({ name: labeler.name, email: labeler.email, count: 0, success: true });
          continue;
        }

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

      // Record when reminder was sent
      settings.reminderSentAt = new Date().toISOString();
      await setMeetingSettings(settings);

      return NextResponse.json({ ok: true, results, sentAt: settings.reminderSentAt });
    }

    return NextResponse.json({ error: '未知的 action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
