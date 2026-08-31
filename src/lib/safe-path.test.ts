import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeInternalPath } from './safe-path.ts';

const BASE = 'https://dashboard.example.com/login';

test('ordinary in-app paths survive', () => {
  assert.equal(safeInternalPath('/etiology'), '/etiology');
  assert.equal(safeInternalPath('/incomplete?owner=A#top'), '/incomplete?owner=A#top');
});

test('anything that leaves this origin falls back to /', () => {
  for (const hostile of [
    '//evil.com',
    '/\\evil.com',      // resolves to https://evil.com — the case a `//` check misses
    '/\t/evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'etiology',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeInternalPath(hostile), '/', JSON.stringify(hostile));
  }
});

test('what survives really does stay on this origin', () => {
  // The property that matters: whatever comes back, resolved against the app,
  // must not point somewhere else.
  for (const candidate of ['/a', '//evil.com', '/\\evil.com', '/x?y=//evil.com', '/\t/evil.com']) {
    const resolved = new URL(safeInternalPath(candidate), BASE);
    assert.equal(resolved.origin, new URL(BASE).origin, candidate);
  }
});

test('a caller can choose its own fallback', () => {
  assert.equal(safeInternalPath('//evil.com', '/login'), '/login');
});
