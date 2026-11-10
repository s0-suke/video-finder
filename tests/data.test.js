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

import { migratePost } from '../js/data.js';

test('保存済みの投稿を新しい品番の判定で直す（分割番号・名前と年齢・タイトル先頭の掲載元の番号）', () => {
  // 以前の版は GDSR-002-2 の分割番号を落とし、タイトルに「2 – 」を残していた
  const a = post(4, 1, { title: '2 – 淫父蕩子', code: 'GDSR-002', group: 'code:GDSR002' });
  assert.equal(migratePost(a), true);
  assert.deepEqual([a.code, a.title, a.group], ['GDSR-002-2', '淫父蕩子', 'code:GDSR0022']);
  // 以前の版は「RYOMA-19歳」を品番にしていた
  const b = post(1, 2, { title: 'あの大人気巨根カコカワモデル涼真-RYOMA-19歳が某ネカフェで', code: 'RYOMA-19', group: 'code:RYOMA19', tags: ['STR8BOYS'] });
  assert.equal(migratePost(b), true);
  assert.equal(b.code, null);
  assert.ok(b.group.startsWith('title:'));
  // 以前の版はタイトル先頭の COCO566-02 を品番にしていなかった
  const c = post(3, 3, { title: 'COCO566-02 – 〈飛貴〉人生初アナルSEX', code: null, group: 'title:x', tags: ['COAT', 'COCO566-02'] });
  assert.equal(migratePost(c), true);
  assert.deepEqual([c.code, c.title, c.group], ['COCO566-02', '〈飛貴〉人生初アナルSEX', 'code:COCO56602']);
  // 正しく判定済みの投稿は変えない
  const d = post(4, 4, { title: '顔射に中出し', code: 'GT-2714', group: 'code:GT2714' });
  assert.equal(migratePost(d), false);
});

test('一覧のスタジオ: 品番・大分類は選ばず、シリーズ名よりレーベル、販売サイトよりメーカーを選ぶ', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }, { id: 4, name: 'b', enabled: true }];
  const many = (n, siteId, tags) => Array.from({ length: n }, (_, i) => post(siteId, 1000 * siteId + n + i, { title: `単独${siteId}-${tags[0]}-${i}`, group: `post:${siteId}:${i}${tags[0]}`, tags }));
  const rows = [
    ...many(4, 1, ['HUNK CHANNEL', 'Hunk Channel']), ...many(3, 4, ['GET-film']), ...many(3, 1, ["MEN'S RUSH.TV"]),
    post(1, 1, { title: '作品X', code: 'DT-031', group: 'code:DT031', tags: ['HUNK CHANNEL', 'DT031', 'Hunk Channel'], studio: 'DT031' }),
    post(4, 1, { title: '作品Y', code: 'OAV-1379', group: 'code:OAV1379', tags: ['Japan Gay Scenes', 'HUNK CHANNEL', 'OAV1379', 'オルガズムモード'] }),
    post(4, 2, { title: '作品Z', code: 'GT-2705', group: 'code:GT2705', tags: ['Japan Gay Scenes', 'GET-film', 'GT-2705', 'Men’s Rush.TV'] }),
    post(1, 2, { title: '作品Z', code: 'GT-2705', group: 'code:GT2705', tags: ["MEN'S RUSH.TV", 'GT-2705'] }),
  ];
  state.posts = new Map(rows.map((p) => [p.key, p]));
  rebuild();
  const by = (code) => state.videos.find((v) => v.code === code);
  assert.equal(by('DT-031').studioKey, 'hunkchannel');
  assert.equal(by('OAV-1379').studioKey, 'hunkchannel');
  assert.equal(by('GT-2705').studioKey, 'getfilm');
  assert.equal(by('GT-2705').sources.length, 2);
  assert.ok(!by('OAV-1379').tags.includes('OAV1379'), '品番だけのタグは表示しない');
  assert.ok(!state.studios.some((s) => s.key === 'dt031' || s.key === 'japangayscenes'));
});

test('一覧の統合: 品番のない投稿を同じタイトルの品番付きの投稿にまとめ、同じサイトの番号の使い回しは分ける', () => {
  state.sites = [{ id: 1, name: 'a', enabled: true }, { id: 4, name: 'b', enabled: true }];
  state.posts = new Map([
    post(1, 1, { title: 'エロ過ぎ!!生突きされ泣き喘ぐ18歳の割れ目にザーメン', code: null, group: 'title:a', tags: ["MEN'S RUSH.TV"] }),
    post(4, 1, { title: 'エロ過ぎ!!生突きされ泣き喘ぐ18歳の割れ目にザーメン', code: 'MR-KR2348', group: 'code:MRKR2348', tags: ['Men’s Rush.TV', 'MR-KR2348'] }),
    post(4, 2, { title: '再編集！巨根！高身長のイケメンが電マで女子をガッツリ攻める！', code: 'BOY-126', group: 'code:BOY126', tags: ['BOY studio', 'BOYST0126'] }),
    post(4, 3, { title: '爽やかイケメンを逆ナンパ！！', code: 'BOY-126', group: 'code:BOY126', tags: ['BOY studio', 'BOY-126'] }),
  ].map((p) => [p.key, p]));
  rebuild();
  assert.equal(state.videos.length, 3);
  assert.equal(state.byKey.get('code:MRKR2348').sources.length, 2);
  assert.equal(state.videos.filter((v) => v.code === 'BOY-126').length, 2);
  assert.equal(new Set(state.videos.map((v) => v.key)).size, 3);
});
