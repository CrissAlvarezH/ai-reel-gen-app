import assert from 'node:assert/strict';
import test from 'node:test';
import {cronMatches, nextRun, parseCron} from '../shared/cron.ts';

test('rejects what cron would reject', () => {
  for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '5-1 * * * *', 'a * * * *', '1,,2 * * * *']) assert.equal(parseCron(bad), null, bad);
});

test('fields: steps, ranges, lists and Sunday as 7', () => {
  assert.ok(cronMatches('*/15 * * * *', new Date(2026, 10, 4, 10, 30)));
  assert.ok(!cronMatches('*/15 * * * *', new Date(2026, 10, 4, 10, 31)));
  assert.ok(cronMatches('5/10 * * * *', new Date(2026, 10, 4, 10, 25)));
  assert.ok(cronMatches('0 9-17/2 * * *', new Date(2026, 10, 4, 11, 0)));
  assert.ok(!cronMatches('0 9-17/2 * * *', new Date(2026, 10, 4, 12, 0)));
  assert.ok(cronMatches('0 8,20 * * *', new Date(2026, 10, 4, 20, 0)));
  // 8 Nov 2026 is a Sunday.
  assert.ok(cronMatches('0 0 * * 7', new Date(2026, 10, 8)));
  assert.ok(cronMatches('0 0 * * 0', new Date(2026, 10, 8)));
});

test('both day fields restricted: either one', () => {
  // 4 Nov 2026 is a Wednesday, 8 Nov a Sunday.
  assert.ok(cronMatches('0 0 4 * 0', new Date(2026, 10, 4)));
  assert.ok(cronMatches('0 0 4 * 0', new Date(2026, 10, 8)));
  assert.ok(!cronMatches('0 0 4 * 0', new Date(2026, 10, 5)));
  // With a * in one of them, only the other counts.
  assert.ok(!cronMatches('0 0 * * 0', new Date(2026, 10, 4)));
});

test('nextRun', () => {
  const now = new Date(2026, 10, 4, 21, 30, 15);
  assert.deepEqual(nextRun('* * * * *', now), new Date(2026, 10, 4, 21, 31));
  assert.deepEqual(nextRun('0 9 * * *', now), new Date(2026, 10, 5, 9, 0));
  assert.deepEqual(nextRun('30 21 * * *', now), new Date(2026, 10, 5, 21, 30)); // this minute has started
  assert.deepEqual(nextRun('0 9 * * 1-5', new Date(2026, 10, 6, 10)), new Date(2026, 10, 9, 9, 0));
  assert.deepEqual(nextRun('0 0 29 2 *', now), new Date(2028, 1, 29));
  assert.equal(nextRun('0 0 31 2 *', now), null);
  assert.equal(nextRun('nope', now), null);
});
