// 出演者データベースの、名前の読み取り・集計（js/actors-core.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActorName, ageFromTitles, countTags, actorHay, actorSummary } from '../js/actors-core.js';

test('別名は ＝ で分け、先頭の実名を表示名にする', () => {
  const a = parseActorName('バキ＝藤村剛気＝哲郎＝大淵祐昭＝ジアン(江添)');
  assert.equal(a.display, 'バキ');
  assert.deepEqual(a.aliases.slice(0, 3), ['バキ', '藤村剛気', '哲郎']);
  assert.equal(a.anonymous, false);
});

test('/ のあとはレーベル（出演者の名前には入れない）', () => {
  const a = parseActorName('ゴーグルマン/GAMES＝かずし');
  assert.equal(a.display, 'ゴーグルマン');
  assert.equal(a.label, 'GAMES');
  assert.deepEqual(a.aliases, ['ゴーグルマン', 'かずし']);
  assert.equal(parseActorName('KENJI＝ゴーグルマン/G-BOT').label, 'G-BOT');
  assert.equal(parseActorName('巨根若パパ25歳/STR8BOYS').label, 'STR8BOYS');
});

test('身長・体重・年齢を、名前から読み取る', () => {
  const a = parseActorName('172cm60kg20歳');
  assert.equal(a.height, 172);
  assert.equal(a.weight, 60);
  assert.equal(a.age, 20);
  assert.equal(a.anonymous, true);
  const b = parseActorName('159cm89kg24才イモカワ');
  assert.deepEqual([b.height, b.weight, b.age], [159, 89, 24]);
  assert.match(b.descriptor, /イモカワ/);
  assert.equal(parseActorName('19才爽やか').age, 19);
  assert.equal(parseActorName('原田さん43歳').age, 43);
});

test('範囲外の数字は、身長・体重・年齢にしない', () => {
  const a = parseActorName('街角ナンパ79');
  assert.deepEqual([a.height, a.weight, a.age], [null, null, null]);
  assert.equal(parseActorName('モデル044').anonymous, true);
});

test('実名の別名があれば、名前のない別名より表示名にする', () => {
  const a = parseActorName('172cm60kg20歳＝山田太郎');
  assert.equal(a.display, '山田太郎');
  assert.equal(a.height, 172);
  assert.equal(a.anonymous, false);
});

test('先頭の記号を除く', () => {
  assert.equal(parseActorName('＿＿田中圭太').display, '田中圭太');
});

test('作品のタイトルから年齢を採る（2 回以上、または作品が少ないとき 1 回）', () => {
  assert.equal(ageFromTitles(['18歳の新人', '18歳の初撮り', '別の作品']), 18);
  assert.equal(ageFromTitles(['20才の大学生']), 20);
  assert.equal(ageFromTitles(['20才の大学生', 'a', 'b', 'c']), null, '作品が多いのに 1 回だけ');
  assert.equal(ageFromTitles([]), null);
  assert.equal(ageFromTitles(['5歳'.replace('5', '99')]), null, '範囲外');
});

test('タグを数えて、多い順に並べる', () => {
  const names = new Map([[1, 'ガッチリ'], [2, 'スリム'], [3, '髭']]);
  const tags = countTags([[1, 2], [1, 3], [1, 99]], names);
  assert.deepEqual(tags, [{ name: 'ガッチリ', n: 3 }, { name: 'スリム', n: 1 }, { name: '髭', n: 1 }]);
});

test('検索用の文字列と、一覧の要約', () => {
  const a = parseActorName('172cm60kg20歳＝山田太郎/G-BOT');
  assert.match(actorHay(a), /山田太郎/);
  assert.match(actorHay(a), /g-bot/);
  assert.equal(actorSummary(a), '172cm・60kg・20歳');
  assert.equal(actorSummary(parseActorName('拳太')), '');
});

test('× でつなぐ形・文章の名前も、数値を読み取り、名前のない出演者として扱う', () => {
  const a = parseActorName('180cm×75kg×20歳のガテン系男子');
  assert.deepEqual([a.height, a.weight, a.age], [180, 75, 20]);
  assert.equal(a.anonymous, true);
  assert.equal(a.descriptor, 'ガテン系男子');
  const b = parseActorName('170×58×21彼女いる大学生イケメンサッカー部');
  assert.deepEqual([b.height, b.weight, b.age], [170, 58, 21]);
  assert.equal(b.anonymous, true);
  const c = parseActorName('推定170cm75kgの鍛えあげられた筋肉君');
  assert.deepEqual([c.height, c.weight], [170, 75]);
  assert.equal(c.anonymous, true);
  assert.equal(parseActorName('めちゃマッチョな髭がセクシーなデカマラくん20歳').anonymous, true);
});

test('実名は匿名扱いにしない（短い名前・別名つき）', () => {
  assert.equal(parseActorName('田中圭太').anonymous, false);
  assert.equal(parseActorName('seiya＝松長遥斗＝ケン＝JUN').anonymous, false);
  assert.equal(parseActorName('緑川瀬斗＝せと＝れい＝旬').display, '緑川瀬斗');
});
