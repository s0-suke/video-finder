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
