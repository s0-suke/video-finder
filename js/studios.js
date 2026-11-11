// スタジオ（レーベル・メーカー）の親子関係
//
// 掲載元のタグ・カテゴリには、会社（メーカー）の名前も、その会社のレーベル・シリーズの名前も同じ「スタジオ」として付く。
// 「KO BEAST」は「KO COMPANY」のレーベル、「EXFEED」は「COAT」のレーベル、「CRUISING」は「G@MES」のシリーズ、のような親子関係を持たせ、
// - 親を選ぶと、子のスタジオの動画もすべて出る
// - スタジオ一覧では、親の下に子を並べる
// - 動画のスタジオを選ぶとき、表で分かっている子（より絞り込まれたもの）を優先する（matching.js の chooseStudio）
// ために使う（純粋関数。ブラウザにも Node のテストにも依存しない）。
//
// 表の書き方:
// - 名前は掲載元での表記のどれでもよい（studioKey で表記ゆれをそろえる）。表にない名前は親なし（独立したスタジオ）。
// - 根拠は、原典の公式サイト（2026-11 に確認）・名前そのもの・掲載元での同時の付き方のどれか。分からない関係は入れない。
// - 親が子の親になる入れ子（KO COMPANY > KO EAST > KO うまのすけ）も書ける。
// - 表は最初に使うときに作る（matching.js と互いに読み込み合っているので、読み込み時には動かさない）。

import { studioKey } from './matching.js';

// { name: 親の名前, note: 根拠, children: [子の名前 | { name, note, children }] }
const TREE = [
  {
    name: 'KO COMPANY',
    note: '株式会社ケーオーカンパニー（大阪）。KO-TUBE（www.ko-tube.com）が自社の配信サイトで、レーベル欄に 41 レーベル。HUNK CHANNEL（b=248）・Men\'s Rush.TV（KO COMPANY 総合）では、KO EAST・STUDIO ZERO のレーベルも KO COMPANY の下に並ぶ',
    // 掲載元（poapan）では「KO 〇〇」の形でレーベルが付く。表にない「KO 〇〇」も KO COMPANY の子とみなす（PREFIX_PARENTS）
    children: [
      'KO TUBE', 'KOPANDA',
      'KO BEAST', 'KO EROS', 'KO SECRET FILM', 'KO KURUU', 'KO PANDORA', 'KO RAOH', 'KO SURPRISE!', 'KO DEEP', 'KO BUMP',
      'KO INDIES', 'KO go guy', 'KO SUITS', 'KO LINE', 'KO Mania Club', 'KO Sportus', 'KO SUPER STAR', 'KO 合法ショタ',
      'KO JOKER', 'KO Tyson', 'KO 男子学園', 'KO JUNO', 'KO ガチ撮り', 'KO XXX', 'KO ガキエロ', 'KO Hunter', 'KO どぴゅノンケ',
      'KO X-BODY', 'KO Top Athlete', 'KO OTOKO', 'KO GOUHOU SHOTA', 'KO DOPYU NONKE', 'KO MODEL\'S', 'KO SCORE',
      'KO Papillon', 'KO Non Fiction', 'KO Gachidori', 'KO 日本男児', 'KO Seed', 'KO ZERO', 'Sonic Film', 'S-Core',
      {
        name: 'KO EAST',
        note: 'KO-TUBE では別メーカー（品番 81）。レーベルは KO-TUBE の KO EAST 欄で確認',
        children: ['KO うまのすけ', 'KO Chaos', 'KO TOKYO ボーイズ', 'KO 益荒男', 'KO Boys Project', 'KO Boys Crash',
          'KO アブSEX', 'KO エンドレス', 'KO 超エロ男子', 'KO Monster', 'KO V-Style', 'KO SUNRISE', 'KO ぶっこみ'],
      },
      {
        name: 'STUDIO ZERO',
        note: 'KO-TUBE では別メーカー（品番 53。今ヌキ隊・キュンC）',
        children: ['KO 今ヌキ隊'],
      },
    ],
  },
  {
    name: 'COAT',
    note: 'コートコーポレーション（COAT CORPORATION ltd.）。CK DOWNLOAD は同社運営の配信サイト（ck-download.com のヘッダー）。CK DOWNLOAD 上のメーカー枠は COAT・KURATATSU・COAT WEST・CK オリジナル',
    children: [
      'EXFEED', 'ROOKIE', 'COAT DICE・K', 'CK DOWNLOAD',
      { name: 'COAT WEST', note: 'CK DOWNLOAD のメーカー枠（mk=28、39 レーベル）。品番 WE…' },
      { name: 'Coat Kuratatsu', note: 'CK DOWNLOAD では KURATATSU（mk=15、17 レーベル。danGet・Fine・ガッちび など）。品番 KU…', children: ['danGet'] },
    ],
  },
  {
    name: 'G@MES',
    note: '有限会社ゲームス（games-video.co.jp）。公式の作品一覧のレーベル（wild・hunk video・裏games・monster・style など）。games-video.co.jp の hunk.php に「MEGA HUNK CHANNEL にて配信している GAMES 商品」として下の各シリーズが載っている',
    children: [
      'HUNK VIDEO', 'Cony CARACAN', 'Collection',
      { name: 'ノンケ激盗撮', note: '公式の「激盗撮シリーズ」（品番 URG）。作品タイトルでは 激盗撮Pro・激盗撮.coffret', children: ['激盗撮pro', '激盗撮ex'] },
      { name: 'バキのガチ撮り', note: 'hunk.php に掲載', children: ['バキのガチ撮りリバース'] },
      'CRUISING', 'のんけ診察室', 'ガッチンコ!!', '超のぞき', 'バキStriker', 'Striker', 'HUNK WORKER',
      'X MODE', 'X MODEリバース', 'MEVIUS MODE', 'GANTS', '真GANTS', 'REAL BODY 3D', 'Body Focus', 'ハイパーYeaah!',
      'G-spot', 'HUNK SPURT',
      { name: 'W.A.M.', children: ['W.A.M. x EVE'] },
      { name: 'ADULT CITY', children: ['にいやん', 'おっちゃん'] },
    ],
  },
  {
    name: 'HUNK CHANNEL',
    note: '販売サイト MEGA HUNK CHANNEL（hunk-ch.com）。メニューの「オリジナルブランド」欄にあるもののうち、G@MES など別会社と分かっていないもの（メニュー上はすべて並列で、親子の記載はない）。GORILLA.TV は同サイトの専用チャンネル',
    children: [
      'オルガズムモード', 'アクメンズ', 'マラ面接', 'ハメドル', 'ノンケの乳搾り', 'ノンケの性処理', 'バキッシュ', '鈴木商店', 'ノンケ部屋',
      'ノンケ★チャットカメラ', '300円movie', 'バーチャルWEBデート', 'ROOM072アナル専科β', 'MOTONARI', 'hands up',
      { name: 'GORILLA.TV', note: 'hunk-ch.com/GORILLA.TV/', children: ['masayasmovie', 'ittofans', 'ikkeifans'] },
    ],
  },
  {
    name: 'Dream',
    note: 'HUNK CHANNEL のメーカー（b=277、子のブランド 11 種。品番 DR-）',
    children: ['BlackBunny', 'delight', '空の願い', 'SM部屋', 'DREAMTIME', '空の部屋', 'エロリーマン', 'Lovebody', 'ローソク×ベッド', '調教M開発', 'フェラックス', 'fabulous'],
  },
  {
    name: 'インディーズ',
    note: 'HUNK CHANNEL のメニューで唯一入れ子になっている項目（b=282、IDS-101〜115 の子ブランド。ブランド欄は「インディーズ」）',
    children: ['リョウタ凸', 'ゆたの実性活', 'Slimたろう', 'SHINTARO', '裏野ゲイ', 'Yutos Private Videos', 'クロケンのSEX LIFE', '若専ムービー', 'Adea Group', 'Daiki movie', 'REACH FILM', 'Next Boy', 'EXS24エンターテイメント'],
  },
  { name: 'G-men', note: 'HUNK CHANNEL のメーカー（b=256）。作品タイトルが【G-men/G-MAX】【G-men/G-LEGEND】', children: ['G-MAX', 'G-LEGEND', 'G-men G-MAX', 'G-men VG-men', 'G-men SM-ZV', 'VG-men', 'SM-ZV'] },
  { name: 'MEC', note: 'HUNK CHANNEL のメーカー「MEC/SYMBOL」（b=217。STARS・PREMIUM・MEC）', children: ['MEC/SYMBOL', 'MEC Stars', 'MEC Symbol', 'MEC VOLCANO'] },
  { name: 'テキーラネオワークス', note: 'HUNK CHANNEL のメーカー（b=213。テキーラネットワーク・テキーラビデオ）', children: ['Tequila', 'テキーラネットワーク', 'テキーラビデオ'] },
  { name: 'ChubbyParadise', note: 'HUNK CHANNEL（b=291）・Men\'s Rush.TV（総合）のメーカー。ちゃびぱら・ChubbyLove・PeroRyo', children: ['ちゃびぱら', 'ChubbyLove', 'PeroRyo', '重量級ブラザーズ', 'ちゃびらぶ'] },
  {
    name: 'MEN\'S RUSH.TV',
    note: '販売サイト Men\'s Rush.TV と、運営元の株式会社メディアウェーブ。メーカー欄「オリジナルブランド」は メンズラッシュ・GET-film・Men\'s Street の 3 つ（company.php・top.php）。ほか、同時に付く割合が 95% 以上のシリーズ',
    children: ['GET FILM', 'MEN\'S STREET', 'きゅーしゅーだんしー', 'JOCK VIDEO', '慶太シリーズ', 'KinKi Boys'],
  },
  {
    name: 'カピバラワークス',
    note: 'Men\'s Rush.TV のメーカー欄で「カピバラワークス（総合）」の下に入れ子（E-MEN+・カピバラワークス・ディグオーバー・メンズキャンプ）',
    children: ['E-MEN+', 'ディグオーバー', 'Men\'s Camp'],
  },
  { name: 'ありのまま男子。', note: 'Men\'s Rush.TV のメーカー欄の入れ子', children: ['アカデミー', 'GACHA＠若い子生堀りぶっかけ専', 'メンログ'] },
  { name: 'Dokking film', note: '撮られたノンケたち・ボーイ・ミーツ・ガールの投稿の 80% 以上に同時に付く', children: ['撮られたノンケたち', 'ボーイ・ミーツ・ガール'] },

  // ---- 名前から分かる系列（レーベル名に親の名前が入っている）----
  { name: 'Next Door Studios', note: '名前: Next Door 〇〇', children: ['Next Door Raw', 'Next Door Buddies', 'Next Door Taboo', 'Next Door Twink', 'Next Door Ebony', 'Next Door Homemade', 'Next Door Films'] },
  { name: 'Cheeks', note: '名前: Cheeks 〇〇', children: ['Cheeks Stand Up', 'CHEEKS CRIMSON BLOOD', 'Cheeks Striker'] },
  { name: 'DANJI VIDEO', note: '名前: DANJI 〇〇', children: ['DANJI MACHO', 'DANJI VIDEO Plus!'] },
  { name: 'OUT LAW', note: '名前: OUT LAW BOLT', children: ['OUT LAW BOLT'] },
  { name: 'Randy Blue', note: '名前: Randy Blue Adrenaline', children: ['Randy Blue Adrenaline'] },
  { name: 'Prism', note: '名前: Prism 〇〇（HUNK CHANNEL のメーカー「プリズム」）', children: ['Prism Gira', 'Prism ZAPPY'] },
  { name: 'Titan Media', note: '名前: TitanMen Fresh', children: ['TitanMen Fresh'] },
  { name: 'Falcon Studios', note: '名前: Falcon Edge。Mustang は Falcon の投稿の 83% に同時に付く（25/30）', children: ['Falcon Edge', 'Mustang'] },

  // ---- 掲載元での同時の付き方から分かる系列（子の投稿の 9 割以上に親が付く）----
  { name: 'Channel 1 Releasing', note: 'All Worlds Video の投稿の 95%（105/111）、Rascal Video の 98%（39/40）に同時に付く', children: ['All Worlds Video', 'Rascal Video'] },
  { name: 'Dark Alley Media', note: 'Raw Fuck Club の投稿の 90%（46/51）に同時に付く', children: ['Raw Fuck Club'] },
];

// 表にない名前でも、名前の形で親が決まるもの（新しいレーベルが増えても追従できるように）
const PREFIX_PARENTS = [
  { test: /^KO\s\S/i, parent: 'KO COMPANY' }, // 「KO BEAST」など。単独の「KO」は KO COMPANY そのもの（studioKey の別名）
];

// 親子関係はないが、公式サイトの表記がはっきりしているスタジオの名前。掲載元では「Acceed」のように大文字小文字がぶれるので、
// 一覧・チップには公式の表記を出す（studioKey は同じなので、動画の振り分けには影響しない）
const OFFICIAL_NAMES = [
  'ACCEED', // acceed.jp のサイト名の表記
];

// ---- 表の展開（最初に使うときに 1 回だけ）----
let built = null;

function build() {
  if (built) return built;
  const parentOf = new Map(); // 子の key -> 親の key
  const displayName = new Map(); // key -> 表の名前（掲載元に出てこない親でも名前を出せるように）
  const notes = new Map(); // key -> 根拠
  const register = (node, parentKey) => {
    const item = typeof node === 'string' ? { name: node } : node;
    const key = studioKey(item.name);
    if (!key) return;
    if (!displayName.has(key)) displayName.set(key, item.name);
    if (item.note) notes.set(key, item.note);
    if (parentKey && parentKey !== key && !parentOf.has(key)) parentOf.set(key, parentKey);
    for (const c of item.children || []) register(c, key);
  };
  for (const root of TREE) register(root, null);
  const prefixParents = PREFIX_PARENTS.map((r) => ({ test: r.test, key: studioKey(r.parent) }));
  const officialName = new Map(OFFICIAL_NAMES.map((n) => [studioKey(n), n]));
  built = { parentOf, displayName, notes, prefixParents, officialName };
  return built;
}

/** 決まっている親の key。なければ ''。名前（name）は接頭辞の判定（「KO 〇〇」など）に使う */
export function parentKeyOf(key, name = '') {
  const { parentOf, prefixParents } = build();
  if (parentOf.has(key)) return parentOf.get(key);
  const label = (name || '').trim();
  if (label) for (const r of prefixParents) if (r.key !== key && r.test.test(label)) return r.key;
  return '';
}

/** key の祖先（近い順）。名前が分かるなら name も渡す（接頭辞の判定に使う） */
export function ancestorsOf(key, name = '') {
  const { displayName } = build();
  const out = [];
  const seen = new Set([key]);
  let cur = key, curName = name;
  for (;;) {
    const p = parentKeyOf(cur, curName);
    if (!p || seen.has(p)) break;
    out.push(p);
    seen.add(p);
    cur = p;
    curName = displayName.get(p) || '';
  }
  return out;
}

/**
 * 表での深さ（親のない表の項目は 0、その子は 1、…）。表にもなく接頭辞にも当てはまらないスタジオは -1。
 * 動画のスタジオを選ぶとき、深いほど絞り込まれたレーベルとして優先する
 */
export function tableDepth(key, name = '') {
  const { displayName, parentOf } = build();
  const anc = ancestorsOf(key, name);
  if (anc.length) return anc.length;
  return displayName.has(key) && !parentOf.has(key) ? 0 : -1;
}

/** 表に載っている名前（親・子とも）。掲載元に出てこない親の表示名に使う */
export const knownStudioName = (key) => build().displayName.get(key) || '';
/** 表にある根拠のメモ */
export const studioNote = (key) => build().notes.get(key) || '';

/**
 * 実際のスタジオ一覧（{ key, name, count }）に、親子関係を付ける。
 * - 各スタジオに parent（親の key。なければ ''）・children（子の key）・total（自分と子孫の本数の合計）を付ける
 * - 一覧にない親（掲載元に単独では付かないが、子がある）も、{ virtual: true, count: 0 } で足す
 * 並べ替えは呼び出し側で行う（total の順）
 */
export function buildStudioTree(studios) {
  const { displayName, officialName } = build();
  const byKey = new Map(studios.map((s) => [s.key, { ...s, parent: '', total: s.count, children: [] }]));
  const ensure = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, name: displayName.get(key) || key, count: 0, virtual: true, parent: '', total: 0, children: [] });
    return byKey.get(key);
  };
  // 親を決める。一覧にない親は仮の親として足す（親の親も辿る）
  const queue = [...byKey.values()];
  while (queue.length) {
    const s = queue.pop();
    const pk = parentKeyOf(s.key, s.name);
    if (!pk) continue;
    const had = byKey.has(pk);
    const p = ensure(pk);
    s.parent = pk;
    p.children.push(s.key);
    if (!had) queue.push(p);
  }
  // 合計（子孫の本数を足す）。入れ子は深いほうから足す
  const depth = (s) => { let d = 0; for (let p = s.parent; p; p = (byKey.get(p) || {}).parent || '') d++; return d; };
  const list = [...byKey.values()].sort((a, b) => depth(b) - depth(a));
  for (const s of list) if (s.parent) byKey.get(s.parent).total += s.total;
  const out = [...byKey.values()];
  // 親の名前は表の正式な名前にする（掲載元では「KO」と付くことが多いが、親としては「KO COMPANY」と出す）
  for (const s of out) if (s.children.length && displayName.has(s.key)) s.name = displayName.get(s.key);
  // 公式の表記がはっきりしているものは、その表記にそろえる
  for (const s of out) if (officialName.has(s.key)) s.name = officialName.get(s.key);
  // 子は total の多い順
  for (const s of out) s.children.sort((x, y) => byKey.get(y).total - byKey.get(x).total);
  return out;
}

/** studios（buildStudioTree の結果）で、key とその子孫すべての key の集合。絞り込みで「親を選ぶと子も入る」ために使う */
export function descendantKeys(studios, key) {
  const byKey = new Map(studios.map((s) => [s.key, s]));
  const out = new Set([key]);
  const stack = [key];
  while (stack.length) {
    const s = byKey.get(stack.pop());
    for (const c of (s && s.children) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
  }
  return out;
}

/** 親から順に並べた表示用の行（{ s, depth }）。入れ子の子も深さつきで並ぶ。studios は total の順に並べておく */
export function studioRows(studios) {
  const byKey = new Map(studios.map((s) => [s.key, s]));
  const rows = [];
  const walk = (s, depth) => {
    rows.push({ s, depth });
    for (const ck of s.children) { const c = byKey.get(ck); if (c) walk(c, depth + 1); }
  };
  for (const s of studios) if (!s.parent) walk(s, 0);
  return rows;
}
