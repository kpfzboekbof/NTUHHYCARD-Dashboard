import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScraperFiles, parseScreeningPathname, scraperExpectation } from './scan-check.ts';

const file = (date: string, site?: string) =>
  `screening/${date.slice(0, 7)}/${site ? `${date}__${site}` : date}.json`;

test('scraperExpectation: unset or blank is auto, "none" pauses, a list is a set', () => {
  assert.equal(scraperExpectation(undefined), 'auto');
  assert.equal(scraperExpectation('   '), 'auto');
  assert.equal(scraperExpectation('none'), 'paused');
  assert.equal(scraperExpectation(' NONE '), 'paused');
  assert.deepEqual(scraperExpectation('main, yunlin,'), new Set(['main', 'yunlin']));
});

test('parseScreeningPathname: site files, legacy single file, and things that are not scans', () => {
  assert.deepEqual(parseScreeningPathname(file('2026-09-15', 'hsinchu')), { date: '2026-09-15', site: 'hsinchu' });
  assert.deepEqual(parseScreeningPathname(file('2025-06-12')), { date: '2025-06-12', site: '(單一檔)' });
  assert.equal(parseScreeningPathname('screening/2026-09/_reviews.json'), null);
  assert.equal(parseScreeningPathname('screening/2026-09/notes.txt'), null);
});

test('paused: nothing to say even when every file is missing', () => {
  assert.equal(checkScraperFiles([], '2026-09-15', 'paused'), null);
  assert.equal(checkScraperFiles([file('2026-09-14', 'bio')], '2026-09-15', 'paused'), null);
});

test('auto: an empty month has nothing to compare against', () => {
  assert.equal(checkScraperFiles(['screening/2026-09/_reviews.json'], '2026-09-15', 'auto'), null);
});

test('auto: the September pattern — only 新竹 ever uploaded, and not today', () => {
  const pathnames = [file('2026-09-14', 'bio'), file('2026-09-14', 'hsinchu'), 'screening/2026-09/_reviews.json'];
  assert.deepEqual(checkScraperFiles(pathnames, '2026-09-15', 'auto'), { missing: ['bio', 'hsinchu'], uploaded: [] });
  // main and yunlin are invisible to auto mode: they never appeared this month.
});

test('auto: a good day has nothing missing', () => {
  const pathnames = [file('2026-09-14', 'main'), file('2026-09-15', 'main')];
  assert.deepEqual(checkScraperFiles(pathnames, '2026-09-15', 'auto'), { missing: [], uploaded: ['main'] });
});

test('explicit sites: a scraper that never uploaded this month is missing, not invisible', () => {
  const expected = new Set(['main', 'hsinchu', 'bio', 'yunlin']);
  assert.deepEqual(checkScraperFiles([], '2026-09-01', expected), {
    missing: ['bio', 'hsinchu', 'main', 'yunlin'],
    uploaded: [],
  });
  const pathnames = [file('2026-09-15', 'main'), file('2026-09-15', 'yunlin'), file('2026-09-14', 'hsinchu')];
  assert.deepEqual(checkScraperFiles(pathnames, '2026-09-15', expected), {
    missing: ['bio', 'hsinchu'],
    uploaded: ['main', 'yunlin'],
  });
});

test('explicit sites: an unexpected upload is reported, not counted as missing', () => {
  const pathnames = [file('2026-09-15', 'main'), file('2026-09-15', 'pilot')];
  assert.deepEqual(checkScraperFiles(pathnames, '2026-09-15', new Set(['main'])), {
    missing: [],
    uploaded: ['main', 'pilot'],
  });
});
