import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingMonths, rankingMonthRange } from '../src/rankingPeriod.ts';
test('October remains available in November and after more than one year', () => {
  assert.deepEqual(rankingMonths('2026-10-22', '2026-11-02'), ['2026-11', '2026-10']);
  const months = rankingMonths('2026-10-22', '2028-01-15');
  assert.equal(months.length, 16);
  assert.equal(months.at(-1), '2026-10');
  assert.deepEqual(months.slice(0, 2), ['2028-01', '2027-12']);
});
test('past months include the last day; current month stops today', () => {
  assert.deepEqual(rankingMonthRange('2026-10', '2026-11-02'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(rankingMonthRange('2026-11', '2026-11-02'), { start: '2026-11-01', end: '2026-11-02' });
  assert.equal(rankingMonthRange('2028-02', '2028-03-01').end, '2028-02-29');
  assert.equal(rankingMonthRange('2027-02', '2027-03-01').end, '2027-02-28');
  assert.equal(rankingMonthRange('2026-12', '2027-01-01').end, '2026-12-31');
});
