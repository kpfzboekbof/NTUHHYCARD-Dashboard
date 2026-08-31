import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToken, verifySessionToken, hasRole,
  SESSION_TTL_SECONDS, type Role,
} from './session.ts';

process.env.SESSION_SECRET ??= 'test-secret-for-session-tests';

const NOW = 1_800_000_000;
const ROLES: Role[] = ['manager', 'viewer'];

test('a freshly issued token verifies and carries its identity', () => {
  const token = createSessionToken('person-1', ROLES, NOW);
  const payload = verifySessionToken(token, NOW);
  assert.equal(payload?.personId, 'person-1');
  assert.deepEqual(payload?.roles, ROLES);
});

test('a token expires', () => {
  const token = createSessionToken('person-1', ROLES, NOW);
  assert.ok(verifySessionToken(token, NOW + SESSION_TTL_SECONDS - 1));
  assert.equal(verifySessionToken(token, NOW + SESSION_TTL_SECONDS), null);
});

test('a tampered payload is rejected', () => {
  // The whole point: nobody can hand themselves the manager role.
  const token = createSessionToken('person-1', ['viewer'], NOW);
  const [body] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ personId: 'person-1', roles: ['manager'], exp: NOW + 1000 }),
  ).toString('base64url');

  assert.notEqual(forged, body);
  assert.equal(verifySessionToken(`${forged}.${token.split('.')[1]}`, NOW), null);
});

test('a token signed with a different secret is rejected', () => {
  const token = createSessionToken('person-1', ROLES, NOW);
  const original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-different-secret';
  try {
    assert.equal(verifySessionToken(token, NOW), null);
  } finally {
    process.env.SESSION_SECRET = original;
  }
});

test('malformed tokens are rejected rather than throwing', () => {
  for (const bad of [undefined, '', 'nodot', '.', 'a.b', 'x'.repeat(50)]) {
    assert.equal(verifySessionToken(bad as string | undefined, NOW), null, String(bad));
  }
});

test('role checks read from the verified payload', () => {
  const payload = verifySessionToken(createSessionToken('p', ['abstractor'], NOW), NOW);
  assert.equal(hasRole(payload, 'abstractor'), true);
  assert.equal(hasRole(payload, 'manager'), false);
  assert.equal(hasRole(null, 'viewer'), false);
});
