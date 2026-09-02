import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLabelerTarget } from './labeler-targets.ts';
import type { Person } from './repo.ts';

/**
 * This decides where a real reminder lands, so the precedence is worth
 * pinning down rather than inferring from the call site.
 */

function person(overrides: Partial<Person> & { id: string }): Person {
  return {
    redcapUsername: null,
    labelerCode: null,
    displayName: '某人',
    email: 'someone@ntuh',
    roles: ['labeler'],
    broadcastOptOut: false,
    notifyPref: 'digest',
    active: true,
    ...overrides,
  };
}

const LINKED = person({ id: 'p1', labelerCode: 5, displayName: '王小明', email: 'registry@ntuh' });

test('the registry address wins over the copy kept beside the labeler code', () => {
  const target = pickLabelerTarget({ code: 5, name: '舊名字', email: 'stale@ntuh' }, new Map([[5, LINKED]]));
  assert.equal(target.email, 'registry@ntuh');
  assert.equal(target.name, '王小明');
  assert.equal(target.personId, 'p1');
  assert.equal(target.fromRegistry, true);
});

test('an unlinked code keeps working on the old address — the change is additive', () => {
  const target = pickLabelerTarget({ code: 7, name: '李小華', email: 'legacy@ntuh' }, new Map());
  assert.equal(target.email, 'legacy@ntuh');
  assert.equal(target.name, '李小華');
  assert.equal(target.personId, null);
  assert.equal(target.fromRegistry, false);
});

test('a labeler with no address anywhere is not a mail target', () => {
  const target = pickLabelerTarget({ code: 3, name: '無信箱' }, new Map());
  assert.equal(target.email, null);
});

test('a linked person supplies the address a labeler entry lacks', () => {
  const target = pickLabelerTarget({ code: 5, name: '無信箱' }, new Map([[5, LINKED]]));
  assert.equal(target.email, 'registry@ntuh');
});

test('codes are matched exactly — labeler 0 is a real code, not a falsy one', () => {
  // The dropdown really uses 0/3/5/6/7, so a truthiness check here would
  // silently strand labeler 0 on the legacy address forever.
  const zero = person({ id: 'p0', labelerCode: 0, displayName: '零號', email: 'zero@ntuh' });
  const target = pickLabelerTarget({ code: 0, name: '舊名字', email: 'stale@ntuh' }, new Map([[0, zero]]));
  assert.equal(target.email, 'zero@ntuh');
  assert.equal(target.personId, 'p0');
});
