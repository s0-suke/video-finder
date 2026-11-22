import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoMatcher, dayLabel, shortDate, normalizeQuery } from '../js/list-core.js';

const v = (title, code = '', extra = '') => ({ hay: normalizeQuery(`${title} ${code} ${extra}`), code });

test('キーワードが空なら、どの動画にも当たる', () => {
  assert.equal(videoMatcher('')(v('なんでも')), true);
  assert.equal(videoMatcher('   ')(v('なんでも')), true);
});

test('空白で区切った語は、すべてに当たる必要がある（全角半角・大文字小文字は気にしない）', () => {
  const m = videoMatcher('ＡＢＣ マッチョ');
  assert.equal(m(v('abc の筋肉マッチョ')), true);
  assert.equal(m(v('abc だけ')), false);
});

test('品番は、ハイフンの有無・大文字小文字を気にせず当たる', () => {
  const x = v('タイトル', 'GT-2720');
  assert.equal(videoMatcher('gt2720')(x), true);
  assert.equal(videoMatcher('GT-2720')(x), true);
  assert.equal(videoMatcher('gt2721')(x), false);
  // 数字を含まない語は、品番では当たらない
  assert.equal(videoMatcher('gt')(v('別', 'GT-2720')), true); // hay に品番が入っているので文字としては当たる
  assert.equal(videoMatcher('zz')(v('別', 'GT-2720')), false);
});

test('履歴の日付の見出し: 今日・昨日・今年・去年', () => {
  const now = new Date(2026, 10, 23, 1, 0).getTime(); // 2026-11-23（月）
  assert.equal(dayLabel(new Date(2026, 10, 23, 0, 5).getTime(), now), '今日');
  assert.equal(dayLabel(new Date(2026, 10, 22, 23, 59).getTime(), now), '昨日');
  assert.equal(dayLabel(new Date(2026, 10, 3, 12, 0).getTime(), now), '11月3日（火）');
  assert.equal(dayLabel(new Date(2025, 10, 3, 12, 0).getTime(), now), '2025年11月3日（月）');
  // 未来の時刻（時計のずれ）は今日として扱う
  assert.equal(dayLabel(new Date(2026, 10, 24, 9, 0).getTime(), now), '今日');
});

test('カードの短い日付: 今年は月/日、それ以外は年/月/日', () => {
  const now = new Date(2026, 10, 23).getTime();
  assert.equal(shortDate('2026-11-04T12:00:00', now), '11/04');
  assert.equal(shortDate('2021-05-23T00:00:00', now), '2021/05/23');
  assert.equal(shortDate('', now), '');
});
