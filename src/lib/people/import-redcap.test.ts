import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImport, displayNameOf } from './import-redcap.ts';
import type { Person } from './repo.ts';
import type { RawUser } from '../redcap/types.ts';

function user(username: string, lastname: string, firstname: string, email: string): RawUser {
  return { username, lastname, firstname, email };
}

function person(overrides: Partial<Person>): Person {
  return {
    id: 'id-1',
    redcapUsername: null,
    labelerCode: null,
    displayName: '某人',
    email: 'someone@example.com',
    roles: ['viewer'],
    broadcastOptOut: false,
    notifyPref: 'digest',
    active: true,
    ...overrides,
  };
}

test('a REDCap account nobody has yet becomes a new person', () => {
  const plan = planImport([user('G03360', '王', '小明', 'a@ntuh.gov.tw')], []);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].input.redcapUsername, 'G03360');
  assert.equal(plan.create[0].input.displayName, '王小明');
  assert.equal(plan.create[0].input.email, 'a@ntuh.gov.tw');
  // Nobody is a manager by virtue of having a REDCap account.
  assert.deepEqual(plan.create[0].input.roles, ['viewer']);
  assert.equal(plan.update.length, 0);
});

test('a rename in REDCap updates the existing row instead of duplicating it', () => {
  const existing = [person({ redcapUsername: 'G03360', displayName: '王小明', email: 'a@ntuh.gov.tw' })];
  const plan = planImport([user('G03360', '王', '大明', 'a@ntuh.gov.tw')], existing);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].current.id, 'id-1');
  assert.deepEqual(plan.update[0].changes, { displayName: '王大明' });
});

test('nothing to do is nothing to write', () => {
  const existing = [person({ redcapUsername: 'G03360', displayName: '王小明', email: 'a@ntuh.gov.tw' })];
  const plan = planImport([user('G03360', '王', '小明', 'A@NTUH.GOV.TW')], existing);
  assert.deepEqual(plan, { create: [], update: [], skipped: [] });
});

test('someone who logged in by email first gets their REDCap account linked', () => {
  // The row already exists from a magic-link sign-in; the import must not
  // create a second one that splits their audit history.
  const existing = [person({ redcapUsername: null, displayName: '王小明', email: 'a@ntuh.gov.tw' })];
  const plan = planImport([user('G03360', '王', '小明', 'a@ntuh.gov.tw')], existing);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.update[0].changes.redcapUsername, 'G03360');
});

test('an email already owned by another REDCap account is reported, not overwritten', () => {
  const existing = [person({ redcapUsername: 'OTHER', email: 'a@ntuh.gov.tw' })];
  const plan = planImport([user('G03360', '王', '小明', 'a@ntuh.gov.tw')], existing);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update, []);
  assert.match(plan.skipped[0].reason, /OTHER/);
});

test('a REDCap account with no email cannot be a login identity', () => {
  const plan = planImport([user('G03360', '王', '小明', '')], []);
  assert.deepEqual(plan.create, []);
  assert.match(plan.skipped[0].reason, /email/);
});

test('two accounts sharing one mailbox: the first wins, the second is reported', () => {
  const plan = planImport(
    [user('A1', '王', '小明', 'shared@ntuh.gov.tw'), user('A2', '李', '小華', 'shared@ntuh.gov.tw')],
    [],
  );
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].input.redcapUsername, 'A1');
  assert.equal(plan.skipped[0].username, 'A2');
});

test('a user with no name falls back to their username', () => {
  assert.equal(displayNameOf(user('G03360', '', '', 'a@b.c')), 'G03360');
});
