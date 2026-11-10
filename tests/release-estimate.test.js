// 発売日の推定（release-estimate.js）
//
// 条件（ESTIMATE）は、3 サイトの全投稿（統合後 45,109 本）と otokoki の全記事 43,769 件での交差検証で決めた。
// 発売日が分かっている品番付きの動画 9,012 本の 30% を隠して推定し直すと（5 回の平均）:
//   条件なし        … 推定できる 85%、誤差の中央値 3 日、7 日以内 72%、42 日超 8.0%
//   採用した条件    … 推定できる 59%、誤差の中央値 2 日、7 日以内 86%、42 日超 1.2%
// 推定で発売日が付く動画は全体の 22.5% → 27.2%（品番のある動画では 40.0% → 49.5%）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseSeries, buildEstimateIndex, estimateRelease, ESTIMATE } from '../js/release-estimate.js';

test('品番を接頭辞と番号に分ける', () => {
  assert.deepEqual(releaseSeries('GT-2719'), { prefix: 'GT', num: 2719 });
  assert.deepEqual(releaseSeries('MR-KR2387'), { prefix: 'MRKR', num: 2387 });
  assert.deepEqual(releaseSeries('tm-op004'), { prefix: 'TMOP', num: 4 });
  assert.equal(releaseSeries('COCO351-05'), null);
  assert.equal(releaseSeries(null), null);
});

const idx = (pts) => buildEstimateIndex(pts.map(([code, date]) => ({ code, date })));

test('前後の既知の品番から番号の比で線形補間し、根拠の品番を返す', () => {
  const index = idx([['GT-2719', '2024-05-10'], ['GT-2725', '2024-05-22T10:00:00']]);
  assert.deepEqual(estimateRelease(index, 'GT-2722'), {
    date: '2024-05-16',
    from: { code: 'GT-2719', date: '2024-05-10' },
    to: { code: 'GT-2725', date: '2024-05-22' },
  });
  // ハイフンの有無は問わない
  assert.equal(estimateRelease(index, 'GT2720').date, '2024-05-12');
});

test('外挿はしない（片側にしか既知の点がない・その番号が既知）', () => {
  const index = idx([['GT-10', '2024-01-01'], ['GT-12', '2024-01-10']]);
  assert.equal(estimateRelease(index, 'GT-9'), null);
  assert.equal(estimateRelease(index, 'GT-13'), null);
  assert.equal(estimateRelease(index, 'GT-10'), null);
  assert.equal(estimateRelease(index, 'MR-11'), null);
  assert.equal(estimateRelease(index, null), null);
});

test('番号差が大きい・日付の間が長い・日付が逆転しているときは推定しない', () => {
  assert.equal(estimateRelease(idx([['GT-1', '2024-01-01'], ['GT-' + (2 + ESTIMATE.maxGap), '2024-01-10']]), 'GT-2'), null);
  assert.ok(estimateRelease(idx([['GT-1', '2024-01-01'], ['GT-' + (1 + ESTIMATE.maxGap), '2024-01-10']]), 'GT-2'));
  assert.equal(estimateRelease(idx([['GT-1', '2024-01-01'], ['GT-3', '2024-04-01']]), 'GT-2'), null);
  assert.equal(estimateRelease(idx([['GT-1', '2024-02-01'], ['GT-3', '2024-01-20']]), 'GT-2'), null);
});

test('番号と日付が逆転しがちな接頭辞は使わない', () => {
  // 隣どうしで 30 日以上さかのぼる箇所が 4 か所中 2 か所（50%）
  const index = idx([['CR-1', '2024-01-01'], ['CR-3', '2024-01-05'], ['CR-4', '2023-06-01'], ['CR-5', '2024-02-01'], ['CR-6', '2023-01-01']]);
  assert.equal(index.get('CR').inversion, 0.5);
  assert.equal(estimateRelease(index, 'CR-2'), null);
});

test('同じ番号が重複したら早い日付を使う', () => {
  const index = buildEstimateIndex([
    { code: 'GT-1', date: '2024-01-05' }, { code: 'GT1', date: '2024-01-01' }, { code: 'GT-3', date: '2024-01-03' }, { code: 'XX', date: '2024-01-01' }, { code: 'GT-4', date: '' },
  ]);
  assert.deepEqual(index.get('GT').pts.map((p) => p.date), ['2024-01-01', '2024-01-03']);
  assert.equal(estimateRelease(index, 'GT-2').date, '2024-01-02');
});
