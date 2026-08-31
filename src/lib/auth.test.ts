import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedUserToken, isValidUserToken,
  expectedAdminToken, isValidAdminToken,
  legacyAuthEnabled,
} from './auth.ts';

/**
 * The shared-password path, which stays accepted until everyone has signed in
 * individually. The switch that turns it off is the part worth testing: it is
 * what makes the migration finishable.
 */

function withEnv(vars: Record<string, string | undefined>, body: () => void) {
  const saved = Object.keys(vars).map(k => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    body();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('a token matching the current password is accepted', () => {
  withEnv({ USER_PASSWORD: 'pw', ADMIN_PASSWORD: 'admin-pw', LEGACY_AUTH: undefined }, () => {
    assert.equal(isValidUserToken(expectedUserToken()), true);
    assert.equal(isValidAdminToken(expectedAdminToken()), true);
    // The two salts differ, so one cookie is not the other.
    assert.notEqual(expectedUserToken(), expectedAdminToken());
    assert.equal(isValidAdminToken(expectedUserToken()), false);
  });
});

test('LEGACY_AUTH=off retires both shared passwords', () => {
  withEnv({ USER_PASSWORD: 'pw', ADMIN_PASSWORD: 'admin-pw', LEGACY_AUTH: undefined }, () => {
    const user = expectedUserToken();
    const admin = expectedAdminToken();
    withEnv({ LEGACY_AUTH: 'off' }, () => {
      assert.equal(legacyAuthEnabled(), false);
      assert.equal(isValidUserToken(user), false);
      assert.equal(isValidAdminToken(admin), false);
    });
    // …and nothing else does.
    withEnv({ LEGACY_AUTH: 'on' }, () => {
      assert.equal(isValidUserToken(user), true);
    });
  });
});

test('an unset password accepts nothing, rather than accepting everything', () => {
  withEnv({ USER_PASSWORD: undefined, ADMIN_PASSWORD: undefined, LEGACY_AUTH: undefined }, () => {
    assert.equal(expectedUserToken(), null);
    assert.equal(isValidUserToken('anything'), false);
    assert.equal(isValidAdminToken('anything'), false);
    assert.equal(isValidUserToken(undefined), false);
  });
});
