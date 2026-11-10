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

test('スタジオはカテゴリ → タグの順で、品番・分類タグ・大分類以外の最初の候補（レーベルの目安がないとき）', () => {
  assert.equal(studioKey(pickStudio(["Men's Rush.TV", 'GT-2720'], ["MEN'S RUSH.TV"])), studioKey("Men's Rush.TV"));
  assert.equal(pickStudio(['GT-2720'], ['AAA', 'Japan Gay Scenes']), null, 'サイトの大分類はスタジオにしない');
  assert.equal(pickStudio(['GT-2720'], ['AAA', 'COAT']), 'COAT');
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

// ---- 3 サイトの全投稿の監査で見つけた誤りの実例 ----

import { studioCandidates, studioRank, chooseStudio, codesOf, clusterPosts, looksLikeCode } from '../js/matching.js';

test('品番の形をしたタグ（掲載元独自の番号）はスタジオにしない', () => {
  // gayvidsclub: タグがアルファベット順に並ぶので、品番が先に来ていた
  assert.equal(studioKey(pickStudio(['DT031', 'Hunk Channel'], ['HUNK CHANNEL'])), 'hunkchannel');
  assert.equal(pickStudio(['FC1653644', 'FC2'], ['FC2']), 'FC2');
  assert.equal(pickStudio(['VDGBXX0351', 'G-Bot'], ['G-BOT']), 'G-BOT');
  // javboys / poapan: KO の番号、分割番号付きの番号、小文字の番号
  assert.equal(pickStudio(['01-08-0111-04', 'KO deep'], ['Japan Gay Scenes']), 'KO deep');
  assert.equal(pickStudio(['CK-Download', 'COCO566-02'], ['Japan Gay Scenes']), 'CK-Download');
  assert.equal(pickStudio(['ona0302', 'エッチな0230'], ['Japan Gay Scenes']), 'エッチな0230');
  assert.equal(pickStudio(['BOY-397 (2)', 'BOY studio'], []), 'BOY studio');
  // レーベル名に数字が入っていても品番扱いしない
  for (const t of ['STR8BOYS', '80 Gays', 'Studio 2000', '1098動画オンラインサロン', 'G-Number']) assert.equal(looksLikeCode(t) && studioCandidates([t]).length === 0, false, t);
});

test('サイトの大分類（Western Movies / Thai / Japan Gay Scenes）はスタジオにしない', () => {
  assert.equal(pickStudio([], ['Western Movies']), null);
  assert.equal(pickStudio([], ['Thai']), null);
  assert.equal(pickStudio(['Bel Ami'], ['Western Movies']), 'Bel Ami');
  assert.equal(pickStudio(['MR-KR1805', 'Men’s Rush.TV'], ['AAA', 'Japan Gay Scenes']), 'Men’s Rush.TV');
});

test('レーベルの目安（単独で付いていた件数）で、シリーズ名・出演者名より レーベル、販売サイトより メーカーを選ぶ（表にあるシリーズは子として採る）', () => {
  const lists = [
    ...Array(5).fill(['HUNK CHANNEL']), ...Array(4).fill(['GET-film']), ...Array(6).fill(["Men's Rush.TV"]),
    ...Array(3).fill(['KO BEAST']), ...Array(3).fill(['KO TUBE']),
    ['HUNK CHANNEL', 'オルガズムモード'], ['HUNK CHANNEL', 'オルガズムモード'], ['HUNK CHANNEL', 'Fuji'],
  ].map(studioCandidates);
  const rank = studioRank(lists);
  // オルガズムモードは HUNK CHANNEL のオリジナルブランド（親子関係の表 studios.js で HUNK CHANNEL の子）。子が分かっていれば販売サイトより子を採る
  assert.equal(pickStudio(['HUNK CHANNEL', 'OAV1379', 'オルガズムモード'], ['Japan Gay Scenes'], rank), 'オルガズムモード', '表にあるシリーズ（子）');
  assert.equal(pickStudio(['HUNK CHANNEL', '未登録のシリーズ'], [], rank), 'HUNK CHANNEL', '表にないシリーズ名は今までどおり販売サイト');
  assert.equal(pickStudio(['Fuji', 'Hunk Channel'], ['HUNK CHANNEL'], rank), 'HUNK CHANNEL', '出演者名');
  assert.equal(pickStudio(['GET-film', 'GT-2705', 'Men’s Rush.TV'], [], rank), 'GET-film', '販売サイトよりメーカー');
  assert.equal(pickStudio(['01-06-0182-03', 'KO BEAST', 'KO TUBE'], [], rank), 'KO BEAST', '販売サイトよりメーカー');
  assert.equal(chooseStudio(['オルガズムモード'], rank), 'オルガズムモード', '候補がそれだけなら採る');
});

test('主要レーベルの別表記を同じキーにまとめる', () => {
  const same = [['G@MES', 'GAMES'], ['西麻布撮影所', 'Nishiazabu Film Studio'], ['KO 裸王 RAOH', 'KO RAOH'], ["Men's Beraker", 'Men’s Breaker'],
    ['BOY STUIDO', 'BOY studio'], ['BRAVO-JAPAN', 'BRAVO!'], ['プリズム', 'Prism'], ['HUNK オリジナル', 'Hunk Channel'], ['CK-Download', 'CK DOWNLOAD'],
    ['TRANCE Video', 'TRANCE-VIDEO'], ['STR8 BOYS', 'STR8BOYS'], ['MENS CAMP', 'Men’s Camp']];
  for (const [a, b] of same) assert.equal(studioKey(a), studioKey(b), `${a} / ${b}`);
  assert.notEqual(studioKey('HUNK VIDEO'), studioKey('HUNK CHANNEL'));
  assert.notEqual(studioKey('COAT'), studioKey('COAT WEST'));
});

test('名前と年齢（涼真-RYOMA-19歳）は品番にしない。CH-00541 のような品番は拾う', () => {
  assert.equal(extractCode('あの大人気巨根カコカワモデル涼真-RYOMA-19歳が某ネカフェで'), null);
  assert.equal(extractCode('人気モデルMASAKI-20歳の生アナル'), null);
  assert.equal(extractCode('x', ['CH-00541']), 'CH-00541');
  assert.equal(extractCode('Chapter-02 night'), null);
  assert.equal(extractCode('x', ['COAT2004']), 'COAT-2004', '大文字の接頭辞なら年に見える番号も品番');
});

test('分割番号（GDSR-002-1 / -2、SILK-207-1）は別の品番にする。GT-2720_DL の付記は外す', () => {
  assert.equal(extractCode('GDSR-002-1 – 淫父蕩子／用騷穴報答爸爸養育之恩'), 'GDSR-002-1');
  assert.notEqual(groupKey(extractCode('GDSR-002-2 – x'), 'x', '1'), groupKey(extractCode('GDSR-002-1 – y'), 'y', '2'));
  assert.equal(extractCode('SILK-207-1 x'), 'SILK-207-1');
  assert.equal(extractCode('GT-2720_DL 逆ハーレム'), 'GT-2720');
  assert.equal(stripCode('GT-2720_DL 逆ハーレム', 'GT-2720'), '逆ハーレム');
  assert.equal(extractCode('【GT-2720】逆ハーレム'), 'GT-2720');
});

test('タイトル先頭の掲載元独自の番号（COCO566-02 / 01-26-0013-02 / VDGBXX0466_001 / FC2-PPV）を品番にして外す', () => {
  for (const [t, c, rest] of [
    ['COCO566-02 – 〈飛貴〉人生初アナルSEX', 'COCO566-02', '〈飛貴〉人生初アナルSEX'],
    ['01-26-0013-02 – 激しい交尾', '01-26-0013-02', '激しい交尾'],
    ['VDGBXX0466_001 – 猛×翔大', 'VDGBXX0466_001', '猛×翔大'],
    ['ORWEMA040 – No.040 人気モデル', 'ORWEMA040', 'No.040 人気モデル'],
    ['FC2-PPV-1365684 – 筋肉', 'FC2-PPV-1365684', '筋肉'],
  ]) {
    assert.equal(extractCode(t), c, t);
    assert.equal(stripCode(t, c), rest, t);
  }
  assert.equal(extractCode('2024 – 総集編'), null);
  assert.equal(extractCode('MB-BYGKI – 数字のない番号'), null);
});

test('FC2 の番号は書き方（FC4468205 / FC2-PPV-4468205）が違っても同じ品番にする', () => {
  assert.equal(extractCode('x', ['FC2', 'FC4468205']), 'FC2-PPV-4468205');
  assert.equal(normalizeCode(extractCode('x', ['FC4468205'])), normalizeCode(extractCode('FC2-PPV-4468205 – x')));
  assert.equal(stripCode('FC2PPV4468205 x', 'FC2-PPV-4468205'), 'x');
});

const post = (key, siteId, rawTitle, tags) => {
  const code = extractCode(rawTitle, tags);
  const title = stripCode(rawTitle, code);
  return { key, siteId, code, title, tags, group: groupKey(code, title, key) };
};
const together = (m, a, b) => m.get(a) === m.get(b);

test('統合: 品番のない投稿は、同じタイトルの品番付きの投稿に合流する', () => {
  const m = clusterPosts([
    post('1:1', 1, 'エロ過ぎ!!生突きされ泣き喘ぐ18歳の割れ目にザーメン', ["MEN'S RUSH.TV"]),
    post('4:1', 4, 'MR-KR2348 – エロ過ぎ!!生突きされ泣き喘ぐ18歳の割れ目にザーメン', ['Men’s Rush.TV', 'MR-KR2348']),
  ]);
  assert.ok(together(m, '1:1', '4:1'));
  assert.equal(m.get('1:1'), 'code:MRKR2348');
});

test('統合: 別の番号のタグ（G-BOT の VDTWXX0033 と BOT-0346）が一致すればまとめる', () => {
  const m = clusterPosts([
    post('1:1', 1, 'デカマラ若リーマン、ゴーグルマンに癒してもらう!', ['G-BOT', 'G-Bot', 'VDTWXX0033']),
    post('3:1', 3, 'BOT-0346 – デカマラ若リーマン、ゴーグルマンに癒してもらう！ほか', ['BOT-0346', 'G-BOT', 'VDTWXX0033']),
    post('1:2', 1, 'FC2 の作品', ['FC2', 'FC3478284']),
    post('4:2', 4, 'FC2-PPV-3478284 – 別サイトでのタイトル', ['FC2-PPV-3478284', 'ONA Collection おなコレ']),
  ]);
  assert.ok(together(m, '1:1', '3:1'));
  assert.ok(together(m, '1:2', '4:2'));
});

test('統合: 同じ品番でも、同じサイトにタイトルの違う投稿があれば別作品として分ける（BOY-126 の番号の使い回し）', () => {
  const m = clusterPosts([
    post('4:160797', 4, 'BOY-126 – 再編集！巨根！高身長のイケメンが電マで女子をガッツリ攻める！', ['BOY studio', 'BOYST0126']),
    post('4:48849', 4, 'BOY-126 – 爽やかイケメンを逆ナンパ！！', ['BOY studio', 'BOY-126']),
    post('1:22903', 1, '再編集!巨根!高身長のイケメンが電マで女子をガッツリ攻める!', ['BOY STUDIO', 'BOY-126']),
  ]);
  assert.ok(together(m, '4:160797', '1:22903'));
  assert.ok(!together(m, '4:48849', '1:22903'));
  assert.equal(new Set(m.values()).size, 2, '統合キーが重ならない');
});

test('統合: 同じタイトルで販売元ごとに番号が違うもの（CAPY-473 / KPP-0473）はまとめ、同じサイトで番号が違うもの（シリーズの各回）はまとめない', () => {
  const m = clusterPosts([
    post('1:1', 1, '初登場!!小麦肌の男前【覇瑠真】20歳!!でかプリ尻', ['Hunk Channel', 'KPP-0473']),
    post('4:1', 4, 'CAPY-473 – 初登場!!小麦肌の男前【覇瑠真】20歳!!でかプリ尻', ['CAPY-473', 'カピバラワークス']),
    post('3:1', 3, 'ACST034 – REITOのハメ撮りジャーニー', ['Acceed', 'ACST034']),
    post('3:2', 3, 'ACST036 – REITOのハメ撮りジャーニー', ['Acceed', 'ACST036']),
    post('4:2', 4, 'ACST036 – REITOのハメ撮りジャーニー', ['Acceed', 'ACST036']),
  ]);
  assert.ok(together(m, '1:1', '4:1'));
  assert.ok(!together(m, '3:1', '3:2'));
  assert.ok(together(m, '3:2', '4:2'));
});

test('統合: 短い英語のタイトル（Raw Passion）は、スタジオが同じときだけまとめる', () => {
  const m = clusterPosts([
    post('3:1', 3, 'Raw Passion', ['Chaosmen']),
    post('3:2', 3, 'Raw Passion', ['Lucas Entertainment']),
    post('3:3', 3, 'Raw Passion', ['Lucas Entertainment']),
    post('4:1', 4, 'Introducing Kurosuke', ['Introducing Kurosuke', 'japanboyz']),
    post('1:1', 1, 'Introducing Kurosuke', ['JAPANBOYZ', 'JapanBoyz']),
  ]);
  assert.ok(!together(m, '3:1', '3:2'));
  assert.ok(together(m, '3:2', '3:3'));
  assert.ok(together(m, '4:1', '1:1'));
});

test('統合に使う品番: タイトルの品番と、品番だけのタグすべて', () => {
  assert.deepEqual(codesOf('雄穴中出し 24', ['G@MES', 'GAMS847', 'WIG-357']).sort(), ['GAMS847', 'WIG357']);
  assert.deepEqual(codesOf('x', ['FC1900097', 'NPR-0036'], 'NPR-0036').sort(), ['FC2PPV1900097', 'NPR0036']);
});

import { isCodeForm, titleSimilarity, titleGrams } from '../js/matching.js';

test('品番の形の判定: タイトル先頭・タグからしか取れない品番も品番の形とみなす（Part-02 などは違う）', () => {
  for (const c of ['GT-2714', 'MR-KR2387', 'GDSR-002-2', 'BWB-383', 'FC2-PPV-1365684', 'COCO566-02', '01-26-0013-02', 'VDGBXX0466_001', 'ORWEMA091', 'CH-00541']) {
    assert.ok(isCodeForm(c), c);
  }
  for (const c of ['PART-02', 'Part-02', 'COVID-19', 'BEST-2023', '', null, 'gt-2714']) assert.ok(!isCodeForm(c), String(c));
});

test('タイトルの似ている度合い: 覚えておける 2 文字組から計算しても同じ値', () => {
  assert.equal(titleSimilarity('abcd', 'abcd'), 1);
  assert.equal(titleSimilarity('abcd', 'xyz'), 0);
  assert.equal(titleSimilarity('abcd', 'bcde'), 2 / 4);
  assert.deepEqual([...titleGrams('A-b c')], ['ab', 'bc']);
});

const shuffle = (a, seed) => { const b = a.slice(); let s = seed; for (let i = b.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = s % (i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

test('統合キーは投稿の並び順・件数で入れ替わらない（重なったら、その group の最小の投稿を含む動画が ~ なしを持つ）', () => {
  // 同じ品番 GT-500 を、同じサイトの別作品 2 本が使っている（掲載元の付け間違い）
  const base = [
    post('1:10', 1, 'GT-500 – 夏の海で出会った体育会の青年', ['GT-500']),
    post('1:20', 1, 'GT-500 – 冬の山小屋で過ごす二人の夜', ['GT-500']),
  ];
  const m0 = clusterPosts(base);
  assert.equal(m0.get('1:10'), 'code:GT500');
  assert.equal(m0.get('1:20'), 'code:GT500~1:20');
  // 「冬」のほうに別サイトの投稿が 2 件増えて件数が逆転しても、~ なしのキーは「夏」のまま
  const more = [...base,
    post('3:5', 3, 'GT-500 – 冬の山小屋で過ごす二人の夜', ['GT-500']),
    post('4:7', 4, 'GT-500 – 冬の山小屋で過ごす二人の夜', ['GT-500'])];
  for (let seed = 1; seed <= 5; seed++) {
    const m = clusterPosts(shuffle(more, seed));
    assert.equal(m.get('1:10'), 'code:GT500', `seed ${seed}`);
    assert.equal(m.get('1:20'), 'code:GT500~1:20', `seed ${seed}`);
    assert.equal(m.get('3:5'), m.get('1:20'));
    assert.equal(m.get('4:7'), m.get('1:20'));
  }
});

test('統合: 同じシリーズ名で別の回（GT-101 / GT-102 / GT-103）を各サイトが載せても 1 本にしない', () => {
  const title = '体育会系男子寮の秘密シリーズ総集編スペシャル';
  const m = clusterPosts([
    post('1:1', 1, `GT-101 – ${title}`, ['GT-101']),
    post('3:1', 3, `GT-102 – ${title}`, ['GT-102']),
    post('4:1', 4, `GT-103 – ${title}`, ['GT-103']),
    post('4:2', 4, 'GT-102 – 体育会系男子寮の秘密 第2話', ['GT-102']),
  ]);
  assert.equal(new Set(['1:1', '3:1', '4:1'].map((k) => m.get(k))).size, 3);
  assert.ok(!together(m, '1:1', '4:2'), 'ほかの回の投稿を吸い込まない');
  assert.ok(together(m, '3:1', '4:2'), '同じ品番の投稿は従来どおりまとまる');
  // 販売元ごとに番号の振り方が違うだけ（接頭辞が違う）ならまとめる
  const m2 = clusterPosts([
    post('1:1', 1, 'とあるマニアの盗撮投稿 Part.06 長い長いタイトル', ['KT83787']),
    post('4:1', 4, '01-01-0231-01 – とあるマニアの盗撮投稿 Part.06 長い長いタイトル', ['01-01-0231-01']),
  ]);
  assert.ok(together(m2, '1:1', '4:1'));
});

test('統合: 同じサイトで品番が食い違う投稿（同じ接頭辞で数字が違う）は、タイトルが似ていてもまとめない', () => {
  const m = clusterPosts([
    post('1:1', 1, '腹筋パキパキ元バレー部員が男のキスにウットリ', ['BOT-0322', 'VDGBXX0178']),
    post('1:2', 1, '腹筋パキパキ元バレー部員が男のキスにウットリ', ['BOT-0302', 'VDGBXX0171']),
    post('1:3', 1, '腹筋パキパキ元バレー部員が男のキスにウットリ', ['VDGBXX0178']),
    post('3:1', 3, 'BOT-0322 – 腹筋パキパキ元バレー部員が男のキスにウットリ', ['BOT-0322', 'VDGBXX0178']),
  ]);
  assert.ok(!together(m, '1:1', '1:2'));
  assert.ok(together(m, '1:1', '3:1'));
  assert.ok(together(m, '1:3', '3:1'), '番号の振り方が違うだけの同じサイトの再掲載はまとめる');
});

test('一般語と重なるスタジオの別表記は、掲載元の書き方と完全に同じときだけ使う', () => {
  assert.equal(studioKey('GAMES'), studioKey('G@MES'));
  assert.notEqual(studioKey('Games'), studioKey('G@MES'));
  assert.notEqual(studioKey('games'), studioKey('G@MES'));
  assert.equal(studioKey('KO'), studioKey('KO COMPANY'));
  assert.equal(studioKey('KO Company'), studioKey('KO COMPANY'));
  assert.notEqual(studioKey('Ko'), studioKey('KO COMPANY'));
});
