import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchReminderMail } from './batch-reminder.ts';
import type { Batch } from '../db/batches.ts';
import type { PersonBacklog } from '../state/backlog.ts';

const NOW = new Date('2026-09-10T02:00:00Z'); // 2026-09-10 10:00 Taipei

const BATCH: Batch = {
  id: 'b1',
  name: '第三批基本表單',
  studyIdCutoff: 5000,
  dueDate: '2026-09-30',
  unitIds: [],
  createdBy: null,
  createdAt: NOW.toISOString(),
  closedAt: null,
};

const BACKLOG: PersonBacklog = {
  personId: 'p1',
  username: 'ALICE',
  displayName: '王小明',
  nameSource: 'registry',
  email: 'alice@ntuh.gov.tw',
  units: [
    { unitId: 'u.a', label: 'Core 助理', deepLinkPage: 'ntuh_nhi_core', ready: ['101', '102'], awaiting: [] },
    { unitId: 'u.b', label: 'Outcome 助理', deepLinkPage: 'ntuh_nhi_outcome', ready: [], awaiting: ['103'] },
  ],
  readyCount: 2,
  awaitingCount: 1,
  total: 3,
};

test('the subject carries the count and the urgency, because that is what gets read', () => {
  const mail = batchReminderMail(BATCH, BACKLOG, 'https://redcap/x?pid=1');
  assert.match(mail.subject, /還有 3 筆未完成/);
  assert.match(mail.subject, /第三批基本表單/);
});

test('the body separates what to fill in from what to sign off, per unit', () => {
  const { html } = batchReminderMail(BATCH, BACKLOG, 'https://redcap/x?pid=1');
  assert.match(html, /Core 助理/);
  assert.match(html, /尚未填寫（2 筆）/);
  assert.match(html, /待您確認簽核（1 筆）/);
  assert.match(html, /收案編號 ≤ 5000/);
  assert.match(html, /2026-09-30/);
});

test('every study id becomes a REDCap deep link on its own unit page', () => {
  const { html } = batchReminderMail(BATCH, BACKLOG, 'https://redcap/x?pid=1');
  assert.match(html, /id=101&amp;page=ntuh_nhi_core/);
  assert.match(html, /id=103&amp;page=ntuh_nhi_outcome/);
});

test('a name carrying markup cannot rewrite the mail', () => {
  const hostile = { ...BACKLOG, displayName: '<a href="https://evil">點此</a>' };
  const { html } = batchReminderMail(BATCH, hostile, 'https://redcap/x?pid=1');
  assert.ok(!html.includes('<a href="https://evil">'));
  assert.match(html, /&lt;a href=/);
});

test('a long list is truncated but still states the true total', () => {
  const many = Array.from({ length: 40 }, (_, i) => String(i + 1));
  const backlog = {
    ...BACKLOG,
    units: [{ unitId: 'u.a', label: 'Core 助理', deepLinkPage: 'p', ready: many, awaiting: [] }],
    readyCount: 40, awaitingCount: 0, total: 40,
  };
  const { html } = batchReminderMail(BATCH, backlog, 'https://redcap/x?pid=1');
  assert.match(html, /等共 40 筆/);
  assert.match(html, /尚未填寫（40 筆）/);
});

test('a batch with no due date says so rather than printing a blank', () => {
  const { subject, html } = batchReminderMail({ ...BATCH, dueDate: null }, BACKLOG, 'https://redcap/x?pid=1');
  assert.ok(!subject.includes('（）'));
  assert.match(html, /未設定截止日/);
});
