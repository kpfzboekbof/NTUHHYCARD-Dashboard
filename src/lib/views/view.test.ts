import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { defineView, invalidateViews, readView, resetViewsForTests, storeView, type DurableStore } from './view.ts';
import { REDCAP_EXPORT_LOCK } from './store.ts';

/**
 * The read/refresh contract, against an in-memory stand-in for Postgres+Blob
 * and a scheduler that collects deferred jobs instead of running them after
 * a response.
 */

interface Row {
  data?: unknown;
  fetchedAt?: string;
  invalidatedAt: string | null;
  refreshStartedAt: string | null;
  refreshAttempts: number;
}

function fakeStore() {
  const rows = new Map<string, Row>();
  const row = (key: string) => rows.get(key) ?? { invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 };
  const store: DurableStore = {
    async readStoredView<T>(key: string) {
      const r = rows.get(key);
      if (!r || r.fetchedAt === undefined) return null;
      return { data: r.data as T, fetchedAt: r.fetchedAt, invalidatedAt: r.invalidatedAt, refreshStartedAt: r.refreshStartedAt, refreshAttempts: r.refreshAttempts, bytes: 1 };
    },
    async readViewHead(key: string) {
      const r = rows.get(key);
      if (!r) return null;
      return { key, fetchedAt: r.fetchedAt ?? null, invalidatedAt: r.invalidatedAt, refreshStartedAt: r.refreshStartedAt, refreshAttempts: r.refreshAttempts, bytes: 1 };
    },
    async writeStoredView(key: string, data: unknown, fetchedAt: string) {
      const r = row(key);
      const keep = r.invalidatedAt && Date.parse(r.invalidatedAt) > Date.parse(fetchedAt) ? r.invalidatedAt : null;
      rows.set(key, { data, fetchedAt, invalidatedAt: keep, refreshStartedAt: null, refreshAttempts: 0 });
      return { bytes: 1, invalidatedAt: keep };
    },
    async claimLease(key: string, leaseSeconds: number, countAttempt: boolean) {
      const r = row(key);
      const now = Date.now();
      if (r.refreshStartedAt && now - Date.parse(r.refreshStartedAt) < leaseSeconds * 1000) return null;
      const token = new Date(now).toISOString();
      rows.set(key, { ...r, refreshStartedAt: token, refreshAttempts: r.refreshAttempts + (countAttempt ? 1 : 0) });
      return token;
    },
    async releaseLease(key: string, token: string) {
      const r = rows.get(key);
      if (r && r.refreshStartedAt === token) rows.set(key, { ...r, refreshStartedAt: null });
    },
    async invalidateStoredViews(keys: string[], at: string) {
      for (const key of keys) rows.set(key, { ...row(key), invalidatedAt: at });
    },
  };
  return { store, rows };
}

let jobs: Array<() => Promise<void>> = [];
let fake: ReturnType<typeof fakeStore>;

beforeEach(() => {
  jobs = [];
  fake = fakeStore();
  resetViewsForTests({ scheduler: job => { jobs.push(job); }, store: fake.store });
});

async function runJobs() {
  const pending = jobs;
  jobs = [];
  for (const job of pending) await job();
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function counterView(key: string, extra: Partial<Parameters<typeof defineView<{ n: number }>>[0]> = {}) {
  let n = 0;
  const view = defineView<{ n: number }>({
    key,
    freshSeconds: 600,
    exportsFromRedcap: true,
    build: async () => ({ n: ++n }),
    ...extra,
  });
  return { view, builds: () => n };
}

test('nothing stored: the first read builds in the foreground and persists', async () => {
  const { view, builds } = counterView('a');
  const result = await readView(view);
  assert.equal(result.source, 'built');
  assert.equal(result.data.n, 1);
  assert.equal(builds(), 1);
  assert.equal(fake.rows.get('a')?.fetchedAt, result.fetchedAt);
});

test('a fresh build is served without building again', async () => {
  const { view, builds } = counterView('a');
  await readView(view);
  const again = await readView(view);
  assert.equal(again.source, 'memory');
  assert.equal(again.stale, false);
  assert.equal(builds(), 1);
  assert.equal(jobs.length, 0);
});

test('a stale build is served at once and rebuilt behind the response', async () => {
  const { view, builds } = counterView('a');
  fake.rows.set('a', { data: { n: 0 }, fetchedAt: minutesAgo(20), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 });

  const served = await readView(view);
  assert.equal(served.source, 'store');
  assert.equal(served.data.n, 0);
  assert.equal(served.stale, true);
  assert.equal(served.refreshing, true);
  assert.equal(builds(), 0, 'the request did not wait for REDCap');
  assert.equal(jobs.length, 1);

  await runJobs();
  assert.equal(builds(), 1);
  const after = await readView(view);
  assert.equal(after.data.n, 1);
  assert.equal(after.stale, false);
  assert.equal(fake.rows.get(REDCAP_EXPORT_LOCK)?.refreshStartedAt, null, 'the REDCap lease was released');
});

test('a background job gives way when REDCap is busy on another instance', async () => {
  const { view, builds } = counterView('a');
  fake.rows.set('a', { data: { n: 0 }, fetchedAt: minutesAgo(20), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 });
  fake.rows.set(REDCAP_EXPORT_LOCK, { invalidatedAt: null, refreshStartedAt: new Date().toISOString(), refreshAttempts: 0 });

  await readView(view);
  await runJobs();
  assert.equal(builds(), 0);
  assert.equal(fake.rows.get('a')?.refreshStartedAt, null, 'the view lease was given back');
});

test('an invalidated refresh-mode view is served stale and refreshed', async () => {
  const { view, builds } = counterView('a');
  await readView(view);
  await invalidateViews(['a']);

  const served = await readView(view);
  assert.equal(served.stale, true);
  assert.equal(builds(), 1, 'no foreground rebuild');
  assert.equal(jobs.length, 1);
  await runJobs();
  assert.equal(builds(), 2);
  assert.equal((await readView(view)).stale, false);
});

test('an invalidated rebuild-mode view waits for a fresh build', async () => {
  const { view, builds } = counterView('a', { onInvalidate: 'rebuild' });
  await readView(view);
  await invalidateViews(['a']);

  const served = await readView(view);
  assert.equal(served.source, 'built');
  assert.equal(served.stale, false);
  assert.equal(builds(), 2);
});

test('a rebuild-mode view sees an invalidation written by another instance', async () => {
  const { view, builds } = counterView('a', { onInvalidate: 'rebuild' });
  await readView(view);
  // Another instance handled the write: only the durable row knows.
  fake.rows.set('a', { ...fake.rows.get('a')!, invalidatedAt: new Date().toISOString() });

  const served = await readView(view);
  assert.equal(served.source, 'built');
  assert.equal(builds(), 2);
});

test('a write during a build survives it', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let n = 0;
  const view = defineView<{ n: number }>({
    key: 'a',
    freshSeconds: 600,
    onInvalidate: 'rebuild',
    build: async () => { n++; await gate; return { n }; },
  });

  const building = readView(view);
  await new Promise(resolve => setTimeout(resolve, 5));
  await invalidateViews(['a']);
  release();
  const first = await building;
  assert.equal(first.stale, true, 'the build began before the write, so it may not contain it');

  const second = await readView(view);
  assert.equal(second.source, 'built');
  assert.equal(n, 2);
});

test('force rebuilds now, and answers with what exists when REDCap is taken', async () => {
  const { view, builds } = counterView('a');
  await readView(view);
  const forced = await readView(view, { force: true });
  assert.equal(forced.source, 'built');
  assert.equal(builds(), 2);

  fake.rows.set(REDCAP_EXPORT_LOCK, { invalidatedAt: null, refreshStartedAt: new Date().toISOString(), refreshAttempts: 0 });
  const busy = await readView(view, { force: true });
  assert.equal(busy.source, 'memory');
  assert.equal(busy.refreshing, true);
  assert.equal(builds(), 2, 'no second export beside the running one');
});

test('maxAgeSeconds forces a build when what exists is too old to act on', async () => {
  const { view, builds } = counterView('a');
  fake.rows.set('a', { data: { n: 0 }, fetchedAt: minutesAgo(15), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 });
  const fresh = await readView(view, { maxAgeSeconds: 600 });
  assert.equal(fresh.source, 'built');
  assert.equal(builds(), 1);
});

test('after repeated dead background attempts the view stops promising an update', async () => {
  const { view, builds } = counterView('a');
  fake.rows.set('a', { data: { n: 0 }, fetchedAt: minutesAgo(20), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 3 });
  const served = await readView(view);
  assert.equal(served.stale, true);
  assert.equal(served.refreshing, false);
  assert.equal(served.refreshFailed, true);
  assert.equal(jobs.length, 0);
  assert.equal(builds(), 0);

  // 重新抓取 still works, and resets the counter.
  const forced = await readView(view, { force: true });
  assert.equal(forced.refreshFailed, false);
  assert.equal(fake.rows.get('a')?.refreshAttempts, 0);
});

test('a landed build invalidates its dependents', async () => {
  const { view: source } = counterView('src', { dependents: ['dep'] });
  const { view: dependent, builds } = counterView('dep', { exportsFromRedcap: false, onInvalidate: 'rebuild' });
  await readView(dependent);
  assert.equal(builds(), 1);
  await storeView(source, { n: 9 }, new Date().toISOString());
  const served = await readView(dependent);
  assert.equal(served.source, 'built');
  assert.equal(builds(), 2);
});

test('a build that reads another view which must also build does not deadlock', async () => {
  const { view: inner, builds: innerBuilds } = counterView('inner');
  const outer = defineView<{ inner: number }>({
    key: 'outer',
    freshSeconds: 600,
    exportsFromRedcap: true,
    build: async () => ({ inner: (await readView(inner)).data.n }),
  });
  const result = await Promise.race([
    readView(outer),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('deadlock')), 2000)),
  ]);
  assert.equal(result.data.inner, 1);
  assert.equal(innerBuilds(), 1);
});

test('exporting builds on one instance run one at a time', async () => {
  let running = 0;
  let overlap = 0;
  const make = (key: string) => defineView<{ key: string }>({
    key,
    freshSeconds: 600,
    exportsFromRedcap: true,
    build: async () => {
      running++;
      overlap = Math.max(overlap, running);
      await new Promise(resolve => setTimeout(resolve, 10));
      running--;
      return { key };
    },
  });
  await Promise.all([readView(make('x')), readView(make('y')), readView(make('z'))]);
  assert.equal(overlap, 1);
});

test('a forced composed build re-exports every input, even read in parallel', async () => {
  const { view: a, builds: aBuilds } = counterView('a', { dependents: ['c'] });
  const { view: b, builds: bBuilds } = counterView('b', { dependents: ['c'] });
  const c = defineView<{ a: number; b: number }>({
    key: 'c',
    freshSeconds: 600,
    build: async ctx => {
      const [x, y] = await Promise.all([readView(a, { force: ctx.force }), readView(b, { force: ctx.force })]);
      return { a: x.data.n, b: y.data.n };
    },
  });
  await readView(c);
  const forced = await readView(c, { force: true });
  assert.deepEqual(forced.data, { a: 2, b: 2 });
  assert.equal(aBuilds(), 2);
  assert.equal(bBuilds(), 2);
});

test('an input that lands inside a build does not invalidate that build', async () => {
  const { view: input } = counterView('input', { dependents: ['composed'] });
  let n = 0;
  const composed = defineView<{ n: number }>({
    key: 'composed',
    freshSeconds: 600,
    onInvalidate: 'rebuild',
    build: async ctx => { await readView(input, { force: ctx.force }); return { n: ++n }; },
  });
  const first = await readView(composed);
  assert.equal(first.stale, false, 'the input landed inside this build, which was made from it');
  const again = await readView(composed);
  assert.equal(again.source, 'memory');
  assert.equal(n, 1);
});

test('a job deferred from inside a gated build still queues on the gate', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  // Next's after() binds the callback to the calling async context.
  resetViewsForTests({ scheduler: job => { jobs.push(AsyncLocalStorage.bind(job)); }, store: fake.store });

  let running = 0;
  let overlap = 0;
  const slow = (key: string, extra: Partial<Parameters<typeof defineView<{ key: string }>>[0]> = {}) => defineView<{ key: string }>({
    key,
    freshSeconds: 600,
    exportsFromRedcap: true,
    build: async () => {
      running++;
      overlap = Math.max(overlap, running);
      await new Promise(resolve => setTimeout(resolve, 20));
      running--;
      return { key };
    },
    ...extra,
  });
  const input = slow('input');
  fake.rows.set('input', { data: { key: 'old' }, fetchedAt: minutesAgo(20), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 });
  const outer = slow('outer', { build: async () => { await readView(input); await new Promise(r => setTimeout(r, 20)); return { key: 'outer' }; } });

  await readView(outer); // reads the stale input inside the gate → schedules its refresh
  assert.equal(jobs.length, 1);
  const other = slow('other');
  // The deferred job and a fresh foreground export must not overlap.
  await Promise.all([runJobs(), readView(other)]);
  assert.equal(overlap, 1);
});

test('backing off because REDCap is busy does not count as an attempt', async () => {
  const { view } = counterView('a');
  fake.rows.set('a', { data: { n: 0 }, fetchedAt: minutesAgo(20), invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 });
  fake.rows.set(REDCAP_EXPORT_LOCK, { invalidatedAt: null, refreshStartedAt: new Date().toISOString(), refreshAttempts: 0 });
  await readView(view);
  await runJobs();
  assert.equal(fake.rows.get('a')?.refreshAttempts, 0);
});

test('an invalidated rebuild-mode view waits for the REDCap lease rather than answer with the old build', async () => {
  resetViewsForTests({ scheduler: job => { jobs.push(job); }, store: fake.store, leaseWaitMs: 500, leasePollMs: 10 });
  const { view, builds } = counterView('a', { onInvalidate: 'rebuild' });
  await readView(view);
  await invalidateViews(['a']);
  // Another instance is exporting; it finishes shortly.
  fake.rows.set(REDCAP_EXPORT_LOCK, { invalidatedAt: null, refreshStartedAt: new Date().toISOString(), refreshAttempts: 0 });
  setTimeout(() => fake.rows.set(REDCAP_EXPORT_LOCK, { invalidatedAt: null, refreshStartedAt: null, refreshAttempts: 0 }), 40);

  const served = await readView(view);
  assert.equal(served.source, 'built');
  assert.equal(builds(), 2);
});

test('a newer build whose bytes cannot be read does not launder an older copy', async () => {
  const { view } = counterView('a', { onInvalidate: 'rebuild' });
  await readView(view);
  await invalidateViews(['a']);
  // Another instance landed a newer build (clearing the mark) but its bytes are unreadable here.
  const newer = { ...fake.rows.get('a')!, fetchedAt: new Date(Date.now() + 1000).toISOString(), invalidatedAt: null };
  fake.rows.set('a', newer);
  const store = fake.store;
  const readStoredView = store.readStoredView;
  store.readStoredView = async () => null;
  try {
    const served = await readView(view);
    assert.equal(served.source, 'built', 'the local copy still carried the write it had seen');
  } finally {
    store.readStoredView = readStoredView;
  }
});
