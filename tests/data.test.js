import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, findMoved, rebuild, applyRelease } from '../js/data.js';

const post = (siteId, postId, extra) => ({
  key: `${siteId}:${postId}`, siteId, postId, link: '', title: 't', date: '2026-01-01', tags: [], ...extra,
});

test('同じ品番・同じ統合キーの投稿を 1 本にまとめ、表示用タグからスタジオの言い換えと分類タグを除く', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }, { id: 2, name: 'b', enabled: true }];
  state.posts = new Map([
    ['1:1', post(1, 1, { title: '作品A', code: 'GT-1', group: 'code:GT1', studio: "Men's Rush.TV", tags: ["MEN'S RUSH", '[PORN]', 'ノンケ'] })],
    ['2:9', post(2, 9, { title: '作品A', code: 'GT-1', group: 'code:GT1', studio: "MEN'S RUSH.TV", tags: [] })],
  ]);
  rebuild();
  assert.equal(state.videos.length, 1);
  assert.equal(state.videos[0].sources.length, 2);
  assert.deepEqual(state.videos[0].tags, ['ノンケ']);
  assert.ok(state.videos[0].hay.includes('[porn]'), '検索用には分類タグも残す');
});

test('無効にしたサイトの投稿は一覧に出さない', () => {
  state.sites[1].enabled = false;
  rebuild();
  assert.equal(state.videos[0].sources.length, 1);
  state.sites[1].enabled = true;
});

test('統合キーが変わった動画を品番（ハイフン違いも）かタイトルで探し直せる', () => {
  rebuild();
  assert.equal(findMoved({ code: 'GT1' })?.key, 'code:GT1');
  assert.equal(findMoved({ title: '作品A' })?.key, 'code:GT1');
  assert.equal(findMoved({ code: 'XX-9', title: '別作品' }), null);
});

test('発売日の目安: otokoki の日付があればそれを使い、なければ不明（掲載日で代用しない）', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }];
  state.posts = new Map([
    ['1:1', post(1, 1, { title: '作品B', code: 'GT-2', group: 'code:GT2', date: '2026-11-01' })],
    ['1:2', post(1, 2, { title: '作品C', code: null, group: 'post:1:2', date: '2026-10-01' })],
  ]);
  state.release.byCode.set('GT2', '2026-08-01');
  rebuild();
  const b = state.videos.find((v) => v.code === 'GT-2');
  const c = state.videos.find((v) => v.title === '作品C');
  assert.equal(b.release, '2026-08-01');
  assert.equal(b.releaseKnown, true);
  assert.equal(c.release, '');
  assert.equal(c.releaseKnown, false);
  assert.equal(b.releaseSrc, 'otokoki');
  assert.equal(c.releaseSrc, '');
  state.release.byCode.clear();
});

test('発売日: 公式の配信日を otokoki より優先し、掲載元の投稿日より遅い日付は使わない', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }];
  state.posts = new Map([
    ['1:1', post(1, 1, { title: '作品D', code: 'CO-ME00055', group: 'code:COME00055', date: '2026-06-05' })],
    ['1:2', post(1, 2, { title: '作品E', code: 'GT-3', group: 'code:GT3', date: '2024-01-10' })],
  ]);
  state.release.byCode.set('COME00055', '2026-06-01');
  state.release.official.set('code:COME00055', '2026-05-29');
  state.release.official.set('key:code:GT3', '2026-11-09'); // 再販で新しくなった配信日
  state.release.byCode.set('GT3', '2026-10-01'); // 投稿日より遅い otokoki の日付も使わない
  rebuild();
  const d = state.videos.find((v) => v.code === 'CO-ME00055');
  const e = state.videos.find((v) => v.code === 'GT-3');
  assert.deepEqual([d.release, d.releaseSrc], ['2026-05-29', 'official']);
  assert.deepEqual([e.release, e.releaseKnown, e.releaseSrc], ['', false, '']);
  state.release.byCode.clear();
  state.release.official.clear();
});

test('発売日の推定: 既知の発売日がない品番は前後の品番から推定し、掲載元の投稿日より遅ければ使わない', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }];
  state.posts = new Map([
    ['1:1', post(1, 1, { title: '作品F', code: 'GT-10', group: 'code:GT10', date: '2026-03-01' })],
    ['1:2', post(1, 2, { title: '作品G', code: 'GT-12', group: 'code:GT12', date: '2026-03-01' })],
    ['1:3', post(1, 3, { title: '作品H', code: 'GT-11', group: 'code:GT11', date: '2026-03-01' })],
    ['1:4', post(1, 4, { title: '作品I', code: 'MR-21', group: 'code:MR21', date: '2026-01-02' })], // 推定日より前に掲載
    ['1:5', post(1, 5, { title: '作品J', code: 'GT-13', group: 'code:GT13', date: '2026-03-01' })], // 外挿はしない
  ]);
  state.release.byCode.set('GT10', '2026-02-01');
  state.release.byCode.set('GT12', '2026-02-11');
  state.release.byCode.set('MR20', '2026-01-01');
  state.release.byCode.set('MR22', '2026-01-31');
  state.posts.set('1:6', post(1, 6, { title: '作品K', code: 'MR-20', group: 'code:MR20', date: '2026-03-01' }));
  state.posts.set('1:7', post(1, 7, { title: '作品L', code: 'MR-22', group: 'code:MR22', date: '2026-03-01' }));
  rebuild();
  const v = (code) => state.videos.find((x) => x.code === code);
  assert.deepEqual([v('GT-11').release, v('GT-11').releaseSrc, v('GT-11').releaseKnown], ['2026-02-06', 'estimate', false]);
  assert.deepEqual(v('GT-11').releaseEst, { from: { code: 'GT-10', date: '2026-02-01' }, to: { code: 'GT-12', date: '2026-02-11' } });
  assert.deepEqual([v('MR-21').release, v('MR-21').releaseSrc], ['', '']);
  assert.deepEqual([v('GT-13').release, v('GT-13').releaseSrc], ['', '']);
  assert.equal(v('GT-10').releaseSrc, 'otokoki');
  // あとから既知の日付が分かったら、推定より優先する
  state.release.byCode.set('GT11', '2026-02-03');
  applyRelease(v('GT-11'));
  assert.deepEqual([v('GT-11').release, v('GT-11').releaseSrc, v('GT-11').releaseEst], ['2026-02-03', 'otokoki', null]);
  state.release.byCode.clear();
});
