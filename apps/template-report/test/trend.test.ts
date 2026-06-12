import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTrendSeries, trendDelta, peakPoint } from '../src/data/trend.ts';

test('toTrendSeries 按日期升序并数值化', () => {
  const out = toTrendSeries([
    { date: '2026-06-02', dau: '120' },
    { date: '2026-06-01', dau: 100 },
    { date: '', dau: 9 },
  ]);
  assert.deepEqual(out.map((r) => r.date), ['2026-06-01', '2026-06-02']);
  assert.equal(out[1].dau, 120);
  assert.equal(typeof out[1].dau, 'number');
});

test('trendDelta 期末相对期初的百分比', () => {
  const d = trendDelta([{ date: 'a', dau: 100 }, { date: 'b', dau: 150 }]);
  assert.equal(Math.round(d), 50);
  assert.equal(trendDelta([{ date: 'a', dau: 100 }]), 0);
  assert.equal(trendDelta([]), 0);
});

test('peakPoint 取最大 dau', () => {
  const p = peakPoint([{ date: 'a', dau: 10 }, { date: 'b', dau: 99 }, { date: 'c', dau: 30 }]);
  assert.equal(p?.dau, 99);
  assert.equal(peakPoint([]), undefined);
});
