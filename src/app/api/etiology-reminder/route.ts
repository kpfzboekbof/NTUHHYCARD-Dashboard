import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import nodemailer from 'nodemailer';
import { fetchEtiologyStatus } from '@/lib/redcap/client';
import { getLabelers } from '@/lib/labelers';
import { transformEtiology } from '@/lib/redcap/etiology-transform';
import { getMeetingSettings, setMeetingSettings } from '@/lib/meeting-store';
import { buildReminderEmail } from '@/lib/email-template';

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

/** GET — reminder status: per-labeler incomplete counts + meeting settings */
export async function GET() {
  try {
    const [labelers, rawRows, settings] = await Promise.all([
      getLabelers(),
      fetchEtiologyStatus(),
      getMeetingSettings(),
    ]);

    const { records } = transformEtiology(rawRows, labelers);
    const incompleteRecords = records.filter(r => r.finalCode === null);

    const labelerStatus = labelers.map(l => {
      const incompleteCases = incompleteRecords.filter(
        r => !r.reviewers.find(rev => rev.labelerCode === l.code)?.complete,
      );
      return {
        code: l.code,
        name: l.name,
        email: l.email || null,
        incompleteCount: incompleteCases.length,
        incompleteCaseIds: incompleteCases.map(r => r.studyId),
      };
    });

    return NextResponse.json({
      labelerStatus,
      meetingDate: settings.meetingDate,
      reminderSentAt: settings.reminderSentAt,
      totalIncompleteRecords: incompleteRecords.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — send reminder emails or update meeting date */
export async function POST(request: NextRequest) {
  try {
    if (!(await verifyAdmin())) {
      return NextResponse.json({ error: '未授權，請先以管理員身份登入' }, { status: 401 });
    }

    const body = await request.json();

    // Update meeting date only
    if (body.action === 'setMeetingDate') {
      const settings = await getMeetingSettings();
      settings.meetingDate = body.meetingDate || null;
      await setMeetingSettings(settings);
      return NextResponse.json({ ok: true, meetingDate: settings.meetingDate });
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
      const incompleteRecords = records.filter(r => r.finalCode === null);

      const results: Array<{ name: string; email: string; count: number; success: boolean; error?: string }> = [];

      for (const labeler of labelers) {
        if (!labeler.email) continue;

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
