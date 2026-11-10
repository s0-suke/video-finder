// スタジオの親子関係（js/studios.js と matching.js の chooseStudio）のテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { studioKey, studioCandidates, chooseStudio } from '../js/matching.js';
import { parentKeyOf, ancestorsOf, tableDepth, buildStudioTree, descendantKeys, studioRows, knownStudioName, studioNote } from '../js/studios.js';

const k = studioKey;

test('表にある子の親が分かる（表記ゆれも同じ）', () => {
  assert.equal(parentKeyOf(k('EXFEED'), 'EXFEED'), k('COAT'));
  assert.equal(parentKeyOf(k('exfeed'), 'exfeed'), k('COAT'));
  assert.equal(parentKeyOf(k('CRUISING'), 'CRUISING'), k('G@MES'));
  assert.equal(parentKeyOf(k('Cheeks Stand Up'), 'Cheeks Stand Up'), k('Cheeks'));
  assert.equal(parentKeyOf(k('COAT'), 'COAT'), '', '親のないスタジオは親なし');
  assert.equal(parentKeyOf(k('Bel Ami'), 'Bel Ami'), '', '表にないスタジオは親なし');
});

test('「KO 〇〇」は表になくても KO COMPANY の子。単独の KO は KO COMPANY そのもの', () => {
  assert.equal(parentKeyOf(k('KO 新レーベル'), 'KO 新レーベル'), k('KO COMPANY'));
  assert.equal(k('KO'), k('KO COMPANY'));
  assert.equal(parentKeyOf(k('KO'), 'KO'), '');
  assert.equal(parentKeyOf(k('KOTO Films'), 'KOTO Films'), '', '「KO」で始まるだけの別の名前は子にしない');
});

test('入れ子（KO COMPANY > KO EAST > KO うまのすけ）を辿れる', () => {
  const anc = ancestorsOf(k('KO うまのすけ'), 'KO うまのすけ');
  assert.deepEqual(anc, [k('KO EAST'), k('KO COMPANY')]);
  assert.equal(tableDepth(k('KO うまのすけ'), 'KO うまのすけ'), 2);
  assert.equal(tableDepth(k('KO COMPANY'), 'KO COMPANY'), 0);
  assert.equal(tableDepth(k('Bel Ami'), 'Bel Ami'), -1);
});

test('表の名前と根拠が引ける', () => {
  assert.equal(knownStudioName(k('KO COMPANY')), 'KO COMPANY');
  assert.ok(studioNote(k('COAT')).includes('コートコーポレーション'));
});

test('一覧に親子関係を付ける: 合計・仮の親・並び', () => {
  const tree = buildStudioTree([
    { key: k('COAT'), name: 'COAT', count: 100 },
    { key: k('EXFEED'), name: 'EXFEED', count: 30 },
    { key: k('KO BEAST'), name: 'KO BEAST', count: 20 },
    { key: k('KO うまのすけ'), name: 'KO うまのすけ', count: 5 },
    { key: k('Bel Ami'), name: 'Bel Ami', count: 7 },
  ]);
  const by = new Map(tree.map((s) => [s.key, s]));
  assert.equal(by.get(k('COAT')).total, 130);
  assert.equal(by.get(k('EXFEED')).parent, k('COAT'));
  assert.deepEqual(by.get(k('COAT')).children, [k('EXFEED')]);
  // KO COMPANY は一覧になかったので仮の親になり、KO EAST（これも仮）を経て孫の本数まで合計に入る
  const ko = by.get(k('KO COMPANY'));
  assert.ok(ko.virtual);
  assert.equal(ko.total, 25);
  assert.equal(by.get(k('KO EAST')).parent, k('KO COMPANY'));
  assert.equal(by.get(k('KO EAST')).total, 5);
  assert.equal(by.get(k('Bel Ami')).total, 7);
  assert.equal(by.get(k('Bel Ami')).parent, '');
});

test('親の表示名は表の正式な名前にする', () => {
  const tree = buildStudioTree([
    { key: k('KO'), name: 'KO', count: 10 },
    { key: k('KO BEAST'), name: 'KO BEAST', count: 20 },
  ]);
  assert.equal(tree.find((s) => s.key === k('KO COMPANY')).name, 'KO COMPANY');
});

test('絞り込み: 親を選ぶと子と孫も入り、子を選ぶと子だけ', () => {
  const tree = buildStudioTree([
    { key: k('KO BEAST'), name: 'KO BEAST', count: 1 },
    { key: k('KO うまのすけ'), name: 'KO うまのすけ', count: 1 },
    { key: k('COAT'), name: 'COAT', count: 1 },
  ]);
  const all = descendantKeys(tree, k('KO COMPANY'));
  assert.ok(all.has(k('KO COMPANY')) && all.has(k('KO BEAST')) && all.has(k('KO EAST')) && all.has(k('KO うまのすけ')));
  assert.ok(!all.has(k('COAT')));
  assert.deepEqual([...descendantKeys(tree, k('KO BEAST'))], [k('KO BEAST')]);
});

test('表示用の行は親の下に子が深さつきで並ぶ', () => {
  const tree = buildStudioTree([
    { key: k('COAT'), name: 'COAT', count: 100 },
    { key: k('EXFEED'), name: 'EXFEED', count: 30 },
    { key: k('Bel Ami'), name: 'Bel Ami', count: 7 },
  ]);
  tree.sort((a, b) => b.total - a.total);
  const rows = studioRows(tree).map(({ s, depth }) => `${depth}:${s.name}`);
  assert.deepEqual(rows, ['0:COAT', '1:EXFEED', '0:Bel Ami']);
});

test('動画のスタジオ選び: 販売サイトより、表で分かっているシリーズ（子）を採る', () => {
  assert.equal(chooseStudio(['HUNK CHANNEL', 'CRUISING']), 'CRUISING');
  assert.equal(chooseStudio(['CRUISING', 'HUNK CHANNEL']), 'CRUISING');
  assert.equal(chooseStudio(['G@MES', 'CRUISING']), 'CRUISING', '親より子（より絞り込まれたもの）');
  assert.equal(chooseStudio(['KO COMPANY', 'KO BEAST']), 'KO BEAST');
});

test('動画のスタジオ選び: 表にないレーベルは今までどおり（親に丸めない）', () => {
  assert.equal(chooseStudio(['COAT', '未登録レーベル']), 'COAT', '先頭の候補（これまでと同じ）');
  assert.equal(chooseStudio(['未登録レーベル', 'COAT']), '未登録レーベル');
  assert.equal(chooseStudio([]), null);
  // 掲載元で単独のレーベルと確かめられたもの（rank）が表にないなら、表の子より優先する
  const rank = new Map([[k('R-30'), 5]]);
  assert.equal(chooseStudio(['COAT WEST', 'R-30'], rank), 'R-30');
});

test('品番の頭の英字 + 巻数だけのタグはスタジオにしない（FC2 は除く）', () => {
  assert.deepEqual(studioCandidates(['BIF7', 'CFT1', 'SRK3', 'KO BEAST']), ['KO BEAST']);
  assert.deepEqual(studioCandidates(['FC2']), ['FC2']);
  assert.deepEqual(studioCandidates(['ABBSX']), ['ABBSX'], '数字のない名前は今までどおり');
});

test('親の循環がない（祖先をたどって止まる）', () => {
  for (const name of ['COAT', 'G@MES', 'KO COMPANY', 'HUNK CHANNEL', "MEN'S RUSH.TV", 'Dream', 'インディーズ']) {
    const anc = ancestorsOf(k(name), name);
    assert.ok(!anc.includes(k(name)), `${name} が自分の祖先に入っている`);
  }
});
