import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNameMap, mergeNameMaps, normalizeHistoryRow, mergeHistory } from '../js/backup-core.js';

test('名前の表: 壊れた値は捨て、出演者 id は数字のキーだけ残す', () => {
  assert.deepEqual(normalizeNameMap({ 12: '田中', abc: '無効', 7: 5 }, { numericKeys: true }), { 12: '田中', 7: '7' });
  assert.deepEqual(normalizeNameMap({ COAT: 'COAT', x: null }), { COAT: 'COAT', x: 'x' });
  assert.deepEqual(normalizeNameMap(null), {});
  assert.deepEqual(normalizeNameMap([1, 2]), {});
});

test('名前の表の読み込みは足し合わせで、既にあるものは変えない', () => {
  const { merged, added } = mergeNameMaps({ 1: 'A', 2: 'B' }, { 2: 'X', 3: 'C' });
  assert.deepEqual(merged, { 1: 'A', 2: 'B', 3: 'C' });
  assert.equal(added, 1);
});

test('履歴の行: key と見た日時が正しいものだけ使う', () => {
  assert.equal(normalizeHistoryRow(null), null);
  assert.equal(normalizeHistoryRow({ key: '', at: 1 }), null);
  assert.equal(normalizeHistoryRow({ key: 'a', at: 'x' }), null);
  const r = normalizeHistoryRow({ key: 'a', at: 5, title: 'T', posts: ['p', 3] });
  assert.deepEqual(r, { key: 'a', at: 5, title: 'T', thumb: '', code: '', posts: ['p'] });
});

test('履歴の読み込み: 新しい日時を残し、足した行だけ返す', () => {
  const cur = [{ key: 'a', at: 100, title: 'A', thumb: '', code: '', posts: [] }];
  const { rows, added } = mergeHistory(cur, [
    { key: 'a', at: 200 }, // 新しいほうを残す
    { key: 'b', at: 50, title: 'B' }, // 新規
    { key: 'c', at: 0 }, // 無効
  ]);
  assert.equal(added, 1);
  assert.deepEqual(rows.map((r) => [r.key, r.at]).sort(), [['a', 200], ['b', 50]]);
  assert.equal(rows.find((r) => r.key === 'a').title, 'A'); // 中身は今のものを残す
});

test('履歴の読み込み: 上限を超えた古い行は入れない', () => {
  const cur = [{ key: 'new', at: 1000, title: '', thumb: '', code: '', posts: [] }];
  const { rows } = mergeHistory(cur, [{ key: 'old', at: 1 }], 1);
  assert.deepEqual(rows, []);
});
