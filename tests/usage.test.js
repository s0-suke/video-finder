import test from 'node:test';
import assert from 'node:assert/strict';
import { sessions, summarize, buildExport } from '../js/usage-core.js';

const T = Date.parse('2026-11-15T10:00:00Z');
const ev = (dt, e, o = {}) => ({ t: T + dt, e, ...o });

test('launch と 30 分以上の空きで起動を分ける', () => {
  const e = [ev(0, 'launch'), ev(1000, 'view', { page: 'home:new' }), ev(2000, 'launch'), ev(3000 + 31 * 60000, 'view', { page: 'x' })];
  assert.equal(sessions(e).length, 3);
});

test('最初に開く・再生するまでのタップ数・スクロール量を集計する', () => {
  const e = [
    ev(0, 'launch'), ev(100, 'view', { page: 'home:new' }),
    ev(5000, 'tap', { k: 'card' }), ev(5001, 'open', { src: 'home:new', taps: 1, scroll: 900, ms: 5000, newV: true }),
    ev(9000, 'play', { taps: 2, scroll: 900, ms: 9000 }),
    ev(60 * 60000, 'launch'), ev(60 * 60000 + 10, 'view', { page: 'home:cont' }),
    ev(60 * 60000 + 4000, 'open', { src: 'home:cont', taps: 3, scroll: 0, ms: 4000 }),
  ];
  const s = summarize(e);
  assert.equal(s.sessions, 2);
  assert.equal(s.toFirstOpen.sessionsWith, 2);
  assert.equal(s.toFirstOpen.tapsAvg, 2);
  assert.equal(s.toFirstPlay.sessionsWith, 1);
  assert.equal(s.toFirstPlay.tapsMedian, 2);
  assert.equal(s.opensFromNew, 1);
  assert.deepEqual(s.firstViewCounts.map((x) => x.k).sort(), ['home:cont', 'home:new']);
});

test('書き出しは定義を含み、検索語などの文字を持たない', () => {
  const e = [ev(0, 'launch'), ev(10, 'search', { len: 3, n: 12, at: 'search' })];
  const x = buildExport(e, { app: 'video-finder' });
  assert.equal(x.schema, 'video-finder-usage/1');
  assert.ok(x.definitions.privacy);
  assert.equal(x.events.length, 2);
  assert.ok(!JSON.stringify(x.events).includes('"q"'));
});
