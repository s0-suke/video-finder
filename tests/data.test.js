import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, findMoved, rebuild } from '../js/data.js';

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

test('発売日の目安: otokoki の日付があればそれを、なければ最も早い掲載日を使う', () => {
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
  assert.equal(c.release, '2026-10-01');
  assert.equal(c.releaseKnown, false);
  state.release.byCode.clear();
});
