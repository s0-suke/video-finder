import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, stripCode, groupKey, normalizeCode, pickStudio, studioKey } from '../js/matching.js';

test('タイトル先頭の品番を取り出す', () => {
  assert.equal(extractCode('GT-2714 – 顔射に中出し♂'), 'GT-2714');
  assert.equal(extractCode('MR-KR309 – ビジュアル系男子'), 'MR-KR309');
  assert.equal(extractCode('cr-0529 ソクハメ'), 'CR-0529');
});

test('英字-英字+数字の品番（MR-KR2387）も取り出す', () => {
  assert.equal(extractCode('タイトルのみ', ["Men's Rush.TV", 'MR-KR2387']), 'MR-KR2387');
});

test('タグは品番だけのものに限る（文中の数字列を誤検出しない）', () => {
  assert.equal(extractCode('タイトル', ['Secret Room vol.8', '18歳']), null);
  assert.equal(extractCode('タイトル', ['これは AB-123 を含む長いタグ']), null);
});

test('品番がなければ null', () => {
  assert.equal(extractCode('ノンケの密室ハメ撮りを覗き見!!'), null);
});

test('タイトル先頭の品番と区切り記号を取り除く', () => {
  assert.equal(stripCode('GT-2714 – 顔射に中出し', 'GT-2714'), '顔射に中出し');
  assert.equal(stripCode('MRKR309: 本文', 'MR-KR309'), '本文');
  assert.equal(stripCode('本文だけ', null), '本文だけ');
});

test('ハイフンの有無が違っても同じ統合キーになる', () => {
  assert.equal(normalizeCode('MR-KR2387'), normalizeCode('MRKR2387'));
  assert.equal(groupKey('MR-KR2387', 'a', '1:1'), groupKey('MRKR-2387', 'b', '2:2'));
});

test('品番がなければ正規化したタイトルで統合し、短いタイトルは統合しない', () => {
  assert.equal(groupKey(null, 'ノンケ激盗撮〜Secret Room〜vol.8', '1:1'), groupKey(null, 'ノンケ激盗撮 Secret Room vol.8', '2:9'));
  assert.equal(groupKey(null, 'RUITO×SYO', '1:5'), 'post:1:5');
});

test('スタジオはタグ（品番以外）を優先し、なければカテゴリ', () => {
  assert.equal(pickStudio(["Men's Rush.TV", 'GT-2720'], ["MEN'S RUSH.TV"]), "Men's Rush.TV");
  assert.equal(pickStudio(['GT-2720'], ['AAA', 'Japan Gay Scenes']), 'Japan Gay Scenes');
  assert.equal(pickStudio([], ['AAA']), null);
});

test('スタジオ名の表記ゆれを同じキーにまとめる', () => {
  assert.equal(studioKey("MEN'S RUSH.TV"), studioKey('Men’s Rush.TV'));
});

test('[PORN] や #NEW のような分類タグはスタジオにしない', () => {
  assert.equal(pickStudio(['[PORN]', '#NEW', 'COAT'], []), 'COAT');
  assert.equal(pickStudio(['#W.VID'], ['[LEAK]']), null);
});

test('タグ全体がハイフンなしの品番なら品番として扱い、ハイフン付きと同じキーにする', () => {
  assert.equal(extractCode('ナマ狂い種壺待機5', ['BWB383']), 'BWB-383');
  assert.equal(groupKey(extractCode('x', ['BWB383']), 'x', '1:1'), groupKey('BWB-383', 'y', '2:2'));
  assert.equal(extractCode('タイトル', ['FC2']), null);
  assert.equal(extractCode('タイトル', ['vol12']), null);
});

import { releaseCode, releaseTitleKey } from '../js/matching.js';

test('otokoki のタイトルから品番を取り出す（販売サイトの GV- 接頭辞は除く）', () => {
  assert.equal(releaseCode('GV-KNZ3005 ノンケ'), 'KNZ3005');
  assert.equal(releaseCode('【GET-film】GT-2720 逆ハーレム'), 'GT2720');
  assert.equal(releaseCode('GV-OAV-463 タイトル'), 'OAV463');
  assert.equal(releaseCode('品番なしのタイトル'), null);
});

test('otokoki の先頭の括弧書きを外したタイトルキーが、掲載サイトのタイトルと一致する', () => {
  assert.equal(releaseTitleKey('【BRAVO-JAPAN：Full HD】ノンケハルヤ アナル調教です'), releaseTitleKey('ノンケハルヤ アナル調教です'));
  assert.equal(releaseTitleKey('【インディーズ：Full HD】〈裏野ゲイ〉ノンケマッチョを生ハメ!'), releaseTitleKey('ノンケマッチョを生ハメ！'));
  assert.equal(releaseTitleKey('短い'), null);
});

test('Part-02 / Vol-01 / Best-of-2023 / COVID-19 / Japan2024 などは品番にしない', () => {
  for (const t of ['Hot Guys Part-02', 'Vol-01 special', 'Best-of-2023', 'Episode-12', 'COVID-19 times', 'FullHD-1080']) {
    assert.equal(extractCode(t), null, t);
  }
  assert.equal(extractCode('x', ['Japan2024']), null);
  assert.equal(extractCode('x', ['FullHD1080']), null);
  assert.equal(extractCode('Part-02 GT-2720 本編'), 'GT-2720', '一般語の後ろの本物の品番は拾う');
});

import { safeUrl } from '../js/matching.js';

test('外部 URL は http(s) だけ通し、相対パスは掲載元を基準に解決する', () => {
  assert.equal(safeUrl('javascript:alert(1)', 'https://a.com/p/'), null);
  assert.equal(safeUrl(' JAVASCRIPT:alert(1)', 'https://a.com/p/'), null);
  assert.equal(safeUrl('data:text/html,x', 'https://a.com/p/'), null);
  assert.equal(safeUrl('/embed/xx', 'https://a.com/p/'), 'https://a.com/embed/xx');
  assert.equal(safeUrl('//cdn.b.com/e/1', 'https://a.com/p/'), 'https://cdn.b.com/e/1');
  assert.equal(safeUrl('', 'https://a.com/'), null);
});

test('年に見える番号のハイフン付き品番（GT-1925 / GT-2024）は品番として扱う', () => {
  assert.equal(extractCode('GT-1925 – 色白小柄な大学生'), 'GT-1925');
  assert.equal(extractCode('x', ['GT-2024']), 'GT-2024');
});

test('ハイフンなしで書かれたタイトル先頭の品番（OAV584 – ）も外す', () => {
  assert.equal(stripCode('OAV584 – 隣の大学生', 'OAV-584'), '隣の大学生');
});

test('Summer-2024 / Tokyo-2023 のような語+年は品番にしない（GT-1925 は品番）', () => {
  assert.equal(extractCode('Summer-2024 special'), null);
  assert.equal(extractCode('Tokyo-2023 night'), null);
  assert.equal(extractCode('GT-1925 タイトル'), 'GT-1925');
});

import { ckCodes, parseCkResult, plausibleRelease } from '../js/matching.js';

test('CK DOWNLOAD で検索する品番: COAT グループの作品だけ、掲載元の表記 → 抽出した品番の順', () => {
  assert.deepEqual(ckCodes({ code: null, studio: 'CK DOWNLOAD', titles: ['COCO351-05 – 「COATオリジナル」全身ツル肌'] }), ['COCO351-05']);
  assert.deepEqual(ckCodes({ code: 'CO-ME00055', studio: null, tags: ['CK'], titles: ['No.055 純朴野球部'] }), ['CO-ME00055']);
  assert.deepEqual(ckCodes({ code: null, studio: 'COAT WEST', tags: ['ORWEMA091', 'ノンケ'], titles: ['[maniac オリジナル]No.091'] }), ['ORWEMA091']);
  assert.deepEqual(ckCodes({ code: 'MR-KR2387', studio: "Men's Rush.TV", titles: ['MR-KR2387 – タイトル'] }), [], 'COAT 以外は調べない');
  assert.deepEqual(ckCodes({ code: null, studio: 'COAT', tags: ['Part-02'], titles: ['タイトル'] }), [], '一般語は品番にしない');
});

test('CK DOWNLOAD の検索結果から件数と配信日を取り出す', () => {
  const html = `<p><strong>1</strong>件</p><ul class="title_list"><li><a href="/product/detail/33289">
    <div class="status"><span>CKオリ</span></div><h4>[激撮フィッティングルーム]No.020 営業マン</h4>
    <div class="ftData"><div class="date">2026.11.05</div></div></a></li></ul>
    <ul class="other"><li><div class="date">2020.01.01</div></li></ul>`;
  assert.deepEqual(parseCkResult(html), { total: 1, items: [{ id: '33289', title: '[激撮フィッティングルーム]No.020 営業マン', date: '2026-11-05' }] });
  assert.deepEqual(parseCkResult('<p><strong>25,311</strong>件</p>'), { total: 25311, items: [] });
  // スマホ版
  const sp = `<ul class="title_list"><li><a href="/sp/product/detail/34600"><h3>[激撮フィッティングルーム]No.025</h3>
    <div class="ftData"><div class="date">2026.11.03</div><div class="price"><strong>2,180</strong>円</div></div></a></li></ul>`;
  assert.deepEqual(parseCkResult(sp), { total: null, items: [{ id: '34600', title: '[激撮フィッティングルーム]No.025', date: '2026-11-03' }] });
});

test('掲載元の最初の投稿日より 2 日を超えて遅い発売日は使わない（再販の日付など）', () => {
  assert.equal(plausibleRelease('2026-11-01', '2026-11-03T10:00:00'), true);
  assert.equal(plausibleRelease('2026-11-05', '2026-11-03T10:00:00'), true);
  assert.equal(plausibleRelease('2026-11-06', '2026-11-03T10:00:00'), false);
  assert.equal(plausibleRelease('2026-11-06', ''), true);
  assert.equal(plausibleRelease('', '2026-11-03'), false);
});
