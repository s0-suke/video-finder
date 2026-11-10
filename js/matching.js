// 品番の抽出と、重複をまとめるための統合キー（DOM に依存しない純粋関数。node --test で検証する）

// 品番（例: MR-KR2387, GT-2720, SUPD-123, OR-COAV001-04, SILK-207-1）。
// 直後に付く分割番号（-1 / -04 / _001 / -B）は別の動画なので品番に含める。GT-2720_DL のような付記は含めない。
// 「RYOMA-19歳」のような名前と年齢は品番にしない
export const CODE_RE = /(?<![A-Z0-9])([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6}(?:[-_](?:\d{1,3}|[A-F]))?)(?![A-Z0-9]|[-_]\d|[歳才])/i;

// 品番の形をしているが品番ではない一般的な語（Best-of-2023 / COVID-19 / FullHD-1080 など）
const NOT_CODE = /^(BEST|TOP|NUM|COVID|FULLHD|FHD|HD|UHD|JAPAN|DAY|YEAR|SEASON|MP|H|X|COLLECTION)(?![A-Z])/i;
// 回数・巻数を表す語（Part-02 / Vol-01 / CH-01）。番号が 3 桁までのときだけ品番から除く（CH-00541 は品番）
const ORDINAL = /^(PART|PT|VOL|EP|EPS|EPISODE|SCENE|CHAPTER|CH|NO|DISC|CD|DVD)-?(\d+)/i;
const notCode = (c) => NOT_CODE.test(c) || (ORDINAL.test(c) && c.match(ORDINAL)[2].length <= 3);
const isYear = (digits) => /^(19|20)\d\d$/.test(digits);

// FC2 コンテンツマーケットの番号は書き方がサイトでばらばら（FC2-PPV-1234567 / FC2PPV1234567 / FC1234567）なのでそろえる
const FC2_RE = /^(?:FC2-?PPV-?|FC)(\d{6,8})$/i;
// タイトル先頭の「品番 – 」（COCO566-02 / 01-26-0013-02 / VDGBXX0466_001 / FC2-PPV-1365684 など、掲載元ごとの番号）
const LEAD_RE = /^\s*【?([A-Z0-9]+(?:[-_][A-Z0-9]+){0,4})】?\s+[–—-]\s/i;
// 英数字と - _ だけでできていて、2 桁以上の数字を含む語（品番らしい語。スタジオ名の候補から除くのにも使う）
export const looksLikeCode = (t) => /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*(?:\s*\(\d+\))?$/i.test(t.trim()) && /\d\d/.test(t);

function canonCode(c) {
  const u = c.toUpperCase();
  const fc = u.match(FC2_RE);
  return fc ? 'FC2-PPV-' + fc[1] : u;
}

function codeIn(text) {
  for (const m of text.matchAll(new RegExp(CODE_RE.source, 'gi'))) {
    const code = m[1];
    if (notCode(code) || /-OF-/i.test(code)) continue;
    // 年に見える番号（1925 / 2024）は、接頭辞が 2〜4 文字の大文字のとき（GT-1925）だけ品番として扱う（Summer-2024 などを除く）
    const num = code.match(/-(\d+)(?:[-_][0-9A-F]+)?$/i)?.[1] || '';
    if (isYear(num) && !/^[A-Z]{2,4}-/.test(code)) continue;
    return canonCode(code);
  }
  return null;
}

// タグ全体が品番か（BWB383 → BWB-383、COCO566-02、ORWEMA091、01-26-0013-02、FC4468205 → FC2-PPV-4468205）
function tagCode(t) {
  const s = t.trim().replace(/\s*\(\d+\)$/, ''); // 「BOY-397 (2)」のような重複よけの番号
  const mt = s.match(CODE_RE);
  if (mt && mt[0].length >= s.length - 1) {
    const c = codeIn(s);
    if (c) return c;
  }
  if (FC2_RE.test(s)) return canonCode(s);
  // ハイフンなしの品番は、英字と数字の間にハイフンを補う（Japan2024 のような年は除く。COAT2004 のような大文字 4 文字までの接頭辞は品番）
  const bare = s.match(/^([A-Z]{2,5})(\d{3,5})$/i);
  if (bare) {
    if (NOT_CODE.test(bare[1]) || ORDINAL.test(s)) return null;
    if (isYear(bare[2]) && !/^[A-Z]{2,4}$/.test(bare[1])) return null;
    return `${bare[1]}-${bare[2]}`.toUpperCase();
  }
  // 掲載元独自の番号（英字 2〜8 文字 + 数字 2 桁以上 + 分割番号、または 01-26-0013-02 の形）
  if (/^[A-Z]{2,8}\d{2,8}(?:[-_](?:\d{1,3}|[A-F]))?$/i.test(s) && !notCode(s) && !isYear(s.match(/\d+/)[0])) return s.toUpperCase();
  if (/^[A-Z]{0,3}-?\d{2}-\d{2}-\d{4}-\d{2}$/i.test(s)) return s.toUpperCase();
  return null;
}

// タイトル先頭の「品番 – 」
function leadCode(title) {
  const m = title.match(LEAD_RE);
  if (!m) return null;
  return codeIn(m[1]) || tagCode(m[1]);
}

export function extractCode(title, tags = []) {
  const fromTitle = leadCode(title) || codeIn(title);
  if (fromTitle) return fromTitle;
  for (const t of tags) {
    const c = tagCode(t);
    if (c) return c;
  }
  return null;
}

// 統合に使う、投稿に付いている品番すべて（タイトルの品番と、品番だけのタグ。比較用の形）。
// 掲載元によって同じ作品に別の番号（販売元の番号とメーカーの番号など）が付くことがあるので、どれかが一致すればまとめる
export function codesOf(title, tags = [], code = null) {
  const out = new Set();
  const add = (c) => { if (c) out.add(normalizeCode(c)); };
  add(code);
  add(leadCode(title) || codeIn(title));
  for (const t of tags) add(tagCode(t));
  return [...out];
}

// タグが品番そのものか（表示用のタグから除く）
export const isCodeTag = (t) => extractCode('', [t]) !== null;

// 保存してある品番が、いまの判定で品番として取り出せる形か（タイトル中・タイトル先頭の掲載元の番号・品番だけのタグのどれか）。
// extractCode(code) だけで確かめると、タイトル先頭やタグからしか取れない形（FC2-PPV-1365684 / COCO566-02 / 01-26-0013-02 /
// VDGBXX0466_001 / ORWEMA091 など）を誤った品番とみなしてしまう
export const isCodeForm = (c) => !!c && (codeIn(c) === c || tagCode(c) === c);

// 外部サイトから取った URL を、base を基準に解決して http(s) のものだけ返す（javascript: などは捨てる）
export function safeUrl(u, base) {
  if (!u) return null;
  try {
    const url = new URL(String(u).trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// 比較用に品番からハイフンを除く（MR-KR2387 と MRKR2387 を同一視）
export const normalizeCode = (code) => code.replace(/[-_]/g, '').toUpperCase();

// タイトル先頭の「品番 – 」を取り除く
export function stripCode(title, code) {
  if (!code) return title;
  const body = code.startsWith('FC2-PPV-') ? '(?:FC2-?PPV-?|FC)' + code.slice(8) : code.replace(/[-_]/g, '[-_]?');
  const re = new RegExp('^\\s*【?' + body + '(?:_[A-Z]{2,3}(?![A-Z0-9]))?】?\\s*[–—\\-:：]?\\s*', 'i');
  return title.replace(re, '') || title;
}

export const normalizeTitle = (title) => title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// 品番がない動画は、記号・空白を除いたタイトルで統合する（短すぎるタイトルは誤統合を避けて統合しない）
export function groupKey(code, title, postKey) {
  if (code) return 'code:' + normalizeCode(code);
  const norm = normalizeTitle(title);
  return norm.length >= 10 ? 'title:' + norm : 'post:' + postKey;
}

// ---- 投稿をまとめて動画にする ----

// タイトルの 2 文字ずつの組（記号を除いて正規化したもの）。titleSimilarity の材料で、投稿ごとに覚えておけるよう分けてある
export function titleGrams(title) {
  const n = normalizeTitle(title || '');
  const g = new Set();
  for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2));
  if (n.length === 1) g.add(n);
  return g;
}

const gramSimilarity = (A, B) => {
  if (!A.size || !B.size) return 0;
  if (A.size > B.size) [A, B] = [B, A];
  let k = 0;
  for (const x of A) if (B.has(x)) k++;
  return k / (A.size + B.size - k);
};

// タイトルの似ている度合い（記号を除いた 2 文字ずつの組の重なり。0〜1）
export const titleSimilarity = (a, b) => gramSimilarity(titleGrams(a), titleGrams(b));

// 同じサイトの 2 つの投稿を同じ作品とみなす似ている度合い（これ未満なら、品番が同じでも別作品）
const SAME_SITE_SIM = 0.4;
// これより多くの投稿に付いている「品番」は、品番ではなく分類用の語とみなして統合に使わない
const MAX_CODE_POSTS = 30;
// 英数字だけの短いタイトル（Raw Passion / Full Service など）は別作品で重なりやすいので、スタジオが同じときだけまとめる
const weakTitle = (t) => t.length < 20 && !/[^\x00-\x7F]/.test(t);
// 品番の数字の部分（先頭の 0 は除く）。CAPY-473 と CAPY-0473 は同じ '473'、GT-101 と GT-102 は違う
const codeNumber = (c) => (c.match(/\d+/g) || []).map((d) => d.replace(/^0+(?=\d)/, '')).join('-');

// 統合に使うタイトルのキー（groupKey と同じ正規化。短すぎるものは null）
export const titleKeyOf = (title) => { const t = normalizeTitle(title || ''); return t.length >= 10 ? t : null; };

// 投稿（{ key, siteId, code, title, tags, group, codes?, tkey?, grams? }）をまとめ、投稿の key → 統合キー の Map を返す。
// codes / tkey / grams は覚えておいた codesOf / titleKeyOf / titleGrams の結果（grams が null なら、計算した値をそこに覚える）。
// 1. 品番（codesOf: タイトルの品番と品番だけのタグ。どれか 1 つ一致すればよい）が同じ投稿をまとめる
// 2. 同じタイトル（groupKey と同じ正規化で 10 文字以上）の投稿をまとめる。品番のない投稿は、同じタイトルの品番付きの投稿に合流する。
//    ただし、そのタイトルに別々の品番が付いているとき（同名の別作品・シリーズの各回）はまとめない。
//    販売元ごとに番号の振り方が違うだけ（CAPY-473 と KPP-0473 のように接頭辞が違う）のときだけ例外
// どちらでも、同じサイトの投稿同士は、品番が食い違うもの（同じ接頭辞で数字が違う）・タイトルがまったく違うもの（掲載元の品番の付け間違い、同じ番号の別シリーズ）はまとめない。
// 投稿の並び順には左右されない（key の順に処理する）。
// 統合キーは、まとめた投稿の group のうち品番のもの（なければタイトルのもの）で最も多いもの。
// 別の動画と重なったら、その group を持つ投稿のうち key が最小の投稿を含む動画がそのまま使い、
// ほかは「~その動画の中で最小の投稿の key」を付けて分ける（投稿の件数や追加の順で持ち主が入れ替わらないように）
export function clusterPosts(posts) {
  const n = posts.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (posts[a].key < posts[b].key ? -1 : posts[a].key > posts[b].key ? 1 : 0));
  const parent = Array.from({ length: n }, (_, i) => i);
  const size = new Array(n).fill(1);
  // まとまりごとの、サイト → 投稿の一覧（同じサイトの投稿どうしだけ見比べるため）
  const bySite = posts.map((p, i) => new Map([[p.siteId, [i]]]));
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const tkey = posts.map((p) => (p.tkey !== undefined ? p.tkey : titleKeyOf(p.title)));
  const codes = posts.map((p) => p.codes || codesOf(p.title || '', p.tags || [], p.code));
  const G = new Array(n);
  const gramsOf = (i) => {
    let g = G[i];
    if (!g) {
      const p = posts[i];
      g = G[i] = p.grams || titleGrams(p.title);
      if (p.grams === null) p.grams = g;
    }
    return g;
  };
  const sim = (i, j) => (tkey[i] && tkey[i] === tkey[j] ? 1 : gramSimilarity(gramsOf(i), gramsOf(j)));
  // 品番が食い違う（共通の品番がなく、同じ接頭辞で数字が違う品番を持つ: GT-101 と GT-102）。
  // 接頭辞が違うだけ（BOT-0309 と掲載元の番号 VDGBXX0170）なら番号の振り方の違いなので食い違いとはみなさない
  const parts = codes.map((cs) => cs.map((c) => [c.match(/^[A-Z]*/)[0], codeNumber(c)]));
  const conflict = (i, j) => {
    if (!parts[i].length || !parts[j].length || codes[i].some((c) => codes[j].includes(c))) return false;
    return parts[i].some(([p, n]) => parts[j].some(([q, m]) => p === q && n !== m));
  };
  const sameWork = (i, j) => !conflict(i, j) && sim(i, j) >= SAME_SITE_SIM;
  const union = (i, j) => {
    let a = find(i), b = find(j);
    if (a === b) return;
    if (size[a] < size[b]) [a, b] = [b, a];
    const A = bySite[a], B = bySite[b];
    for (const [site, ys] of B) {
      const xs = A.get(site);
      if (xs) for (const x of xs) for (const y of ys) if (!sameWork(x, y)) return;
    }
    parent[b] = a;
    size[a] += size[b];
    for (const [site, ys] of B) {
      const xs = A.get(site);
      if (xs) for (const y of ys) xs.push(y); else A.set(site, ys);
    }
    bySite[b] = null;
  };

  // 1. 品番
  const byCode = new Map();
  for (const i of order) {
    for (const c of codes[i]) {
      let a = byCode.get(c);
      if (!a) byCode.set(c, (a = []));
      a.push(i);
    }
  }
  for (const list of byCode.values()) {
    if (list.length < 2 || list.length > MAX_CODE_POSTS) continue;
    // 似ているもの同士から先にまとめる（同じサイトの別作品が先に別の投稿とくっつかないように）
    const pairs = [];
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) pairs.push([sim(list[x], list[y]), list[x], list[y]]);
    pairs.sort((a, b) => b[0] - a[0]);
    for (const [, i, j] of pairs) union(i, j);
  }

  // 2. タイトル
  const byTitle = new Map();
  for (const i of order) {
    if (!tkey[i]) continue;
    let a = byTitle.get(tkey[i]);
    if (!a) byTitle.set(tkey[i], (a = []));
    a.push(i);
  }
  for (const [t, list] of byTitle) {
    if (list.length < 2) continue;
    // 別々の品番が付いているときは、同名の別作品（シリーズの各回など）のことが多いのでまとめない。
    // ただしタイトルが長く、どのサイトでも品番が 1 種類で、同じ英字の接頭辞の品番どうしは数字の部分も同じなら、
    // 販売元ごとに番号の振り方が違うだけの同じ作品（CAPY-473 と KPP-0473、KT83787 と 01-01-0231-01、FC2 と SBM-0137）とみなす。
    // 同じ接頭辞で数字が違う（GT-101 / GT-102）のは、同じシリーズ名の別の回
    const codeOf = new Map();
    for (const i of list) if (posts[i].code) codeOf.set(normalizeCode(posts[i].code), posts[i].code);
    if (codeOf.size > 1) {
      if (t.length < 15) continue;
      const numByPrefix = new Map();
      let series = false;
      for (const [norm, raw] of codeOf) {
        const prefix = norm.match(/^[A-Z]*/)[0], num = codeNumber(raw);
        if (numByPrefix.has(prefix) && numByPrefix.get(prefix) !== num) series = true;
        numByPrefix.set(prefix, num);
      }
      if (series) continue;
      const perSite = new Map();
      for (const i of list) {
        if (!posts[i].code) continue;
        if (!perSite.has(posts[i].siteId)) perSite.set(posts[i].siteId, new Set());
        perSite.get(posts[i].siteId).add(normalizeCode(posts[i].code));
      }
      if ([...perSite.values()].some((set) => set.size > 1)) continue;
    }
    if (!weakTitle(t)) { for (const i of list.slice(1)) union(list[0], i); continue; }
    // 短い英語のタイトルは、スタジオの候補（タグ・カテゴリ）が 1 つでも同じ投稿同士だけまとめる
    const labels = list.map((i) => new Set(studioCandidates(posts[i].tags || []).map(studioKey)));
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      if ([...labels[x]].some((k) => labels[y].has(k))) union(list[x], list[y]);
    }
  }

  // 統合キー（まとまりの投稿は key の順に並ぶ）
  const members = new Map();
  for (const i of order) {
    const r = find(i);
    let m = members.get(r);
    if (!m) members.set(r, (m = []));
    m.push(i);
  }
  const rank = (g) => (g.startsWith('code:') ? 2 : g.startsWith('title:') ? 1 : 0);
  const wants = new Map(); // 統合キー → [{ m, owner: その group を持つ最小の投稿の key }]
  for (const m of members.values()) {
    const count = new Map();
    for (const i of m) count.set(posts[i].group, (count.get(posts[i].group) || 0) + 1);
    const key = [...count].sort((a, b) => rank(b[0]) - rank(a[0]) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const owner = posts[m.find((i) => posts[i].group === key)].key;
    let w = wants.get(key);
    if (!w) wants.set(key, (w = []));
    w.push({ m, owner });
  }
  const out = new Map();
  for (const [key, list] of wants) {
    list.sort((a, b) => (a.owner < b.owner ? -1 : 1));
    list.forEach(({ m }, x) => {
      const k = x === 0 ? key : key + '~' + posts[m[0]].key;
      for (const i of m) out.set(posts[i].key, k);
    });
  }
  return out;
}

// スタジオ名ではない分類・告知用のタグ（igay69 の [PORN] / [LEAK] / #NEW など）
export const isNoiseTag = (t) => /^\[.*\]$|^#|^(AAA|uncategorized|未分類)$/i.test(t.trim());

// 掲載サイトの大分類（poapan / javboys のカテゴリ）。レーベル名ではないのでスタジオにしない
const GENERIC_TERM = /^(japan(ese)? (movies|gay scenes|av scenes)|western movies|asian( movies)?|thai|magazine|all gay porn|gay porn)$/i;

// 同じレーベルの別表記（studioKey の形 → 正式なほうの studioKey）。
// 3 サイトの全投稿で、同じ作品に付いたレーベル名の組み合わせから見つけたもの
const STUDIO_ALIASES = new Map(Object.entries({
  西麻布撮影所: 'nishiazabufilmstudio',
  ko裸王raoh: 'koraoh',
  プリズム: 'prism',
  bravojapan: 'bravo', // BRAVO-JAPAN → BRAVO!
  gdude: 'gdudejp',
  rchsjapan: 'rchsstudio',
  menscom: 'mencom', // Men's Com → MEN.com
  bbvideos: 'bbvideo',
  mensberaker: 'mensbreaker', // 掲載元の綴り誤り
  boystuido: 'boystudio',
  コニーキャラバン: 'conycaracan',
  // 販売元の自社作品のタグは販売元にまとめる
  hunkオリジナル: 'hunkchannel',
  ckオリジナル: 'ckdownload',
  kotubeオリジナル: 'kotube',
}));

// 一般的な語と重なる別表記は、掲載元の書き方（大文字だけ）と完全に同じときだけ使う（trim した表記 → 正式なほうの studioKey）。
// 洋物の「Games」「KO（ノックアウト）」のようなタグを G@MES / KO COMPANY に寄せないため
const CASED_ALIASES = new Map(Object.entries({
  GAMES: 'gmes', // javboys の GAMES → G@MES
  KO: 'kocompany', // gayvidsclub のカテゴリ「KO」→ KO COMPANY
}));

// 表記ゆれのあるスタジオ名（MEN'S RUSH.TV / Men's Rush.TV / Men’s Rush.TV、G@MES / GAMES）を同じものとして扱うためのキー
const studioKeyCache = new Map();
export function studioKey(name) {
  if (!name) return '';
  let k = studioKeyCache.get(name);
  if (k === undefined) {
    k = normalizeTitle(name);
    k = CASED_ALIASES.get(name.trim()) || STUDIO_ALIASES.get(k) || k;
    if (studioKeyCache.size > 50000) studioKeyCache.clear();
    studioKeyCache.set(name, k);
  }
  return k;
}

// スタジオ名の候補になるタグ・カテゴリ（品番・分類タグ・大分類を除き、表記ゆれは 1 つにまとめる）
export function studioCandidates(terms) {
  const seen = new Set();
  const out = [];
  for (const t of terms) {
    if (!t || isNoiseTag(t) || GENERIC_TERM.test(t.trim()) || looksLikeCode(t) || CODE_RE.test(t) || tagCode(t)) continue;
    const k = studioKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// レーベル名とみなすのに必要な「単独で付いていた投稿」の数
const LABEL_MIN = 3;
// 複数のメーカーの作品を扱う販売サイト（studioKey の形）。メーカー名も付いていればそちらを採る
const PLATFORMS = new Set(['hunkchannel', 'mensrushtv', 'ckdownload', 'kotube', 'fc2']);

// レーベルらしさの目安: 候補がそれ 1 つだけだった投稿の数（studioKey → 件数）。
// poapan のように「レーベル + 品番」だけのタグが付くサイトや、gayvidsclub のカテゴリから集まる。
// 出演者名・シリーズ名は必ずレーベル名と一緒に付くので数が増えない
// candidateLists は投稿ごとの studioCandidates の結果
export function studioRank(candidateLists) {
  const rank = new Map();
  for (const c of candidateLists) {
    if (c.length === 1) { const k = studioKey(c[0]); rank.set(k, (rank.get(k) || 0) + 1); }
  }
  return rank;
}

// スタジオ名を選ぶ。
// - 品番・分類タグ・大分類（Japan Gay Scenes など）は除く
// - rank（studioRank）があれば、レーベルと分かっている候補のうち最も絞り込まれたもの（件数の少ないもの）を採る。
//   販売サイト（HUNK CHANNEL / Men's Rush.TV など）はメーカー名がなければ採る。
//   javboys の「HUNK CHANNEL（販売元）+ オルガズムモード（シリーズ）」なら HUNK CHANNEL、
//   「GET-film（メーカー）+ Men's Rush.TV（販売元）」なら GET-film
// - それ以外はカテゴリ → タグの順で最初の候補
export function pickStudio(tags, cats = [], rank = null) {
  return chooseStudio(studioCandidates([...cats, ...tags]), rank);
}

// studioCandidates の結果からスタジオ名を選ぶ（pickStudio の後半。候補を覚えておいて選び直すときに使う）
export function chooseStudio(c, rank = null) {
  if (!c.length) return null;
  if (rank) {
    let best = null, bestN = Infinity;
    for (const t of c) {
      const k = studioKey(t);
      const n = rank.get(k) || 0;
      if (n < LABEL_MIN) continue;
      const score = PLATFORMS.has(k) ? n + 1e9 : n; // 販売サイトは最後の候補
      if (score < bestN) { best = t; bestN = score; }
    }
    if (best) return best;
  }
  return c[0];
}

// ---- 発売日の目安（otokoki の記事タイトルとの照合）----

// otokoki のタイトルに入っている品番（GV-KNZ3005 の「GV-」のような販売サイト側の接頭辞は除く）を比較用の形で返す
export function releaseCode(title) {
  const t = title.replace(/(?<![A-Z0-9])GV-/gi, '');
  const m = t.match(/(?<![A-Z0-9])([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})(?![0-9])/i) || t.match(/(?<![A-Z0-9])([A-Z]{2,6}\d{3,6})(?![A-Z0-9])/i);
  return m ? normalizeCode(m[1]) : null;
}

// 先頭の【レーベル：Full HD】[シリーズ]〈出演〉のような括弧書きを外して正規化したタイトル（短すぎるものは照合に使わない）
export function releaseTitleKey(title) {
  let t = title;
  for (let i = 0; i < 4; i++) t = t.replace(/^\s*(?:【[^】]*】|\[[^\]]*\]|〈[^〉]*〉|＜[^＞]*＞|<[^>]*>)\s*/, '');
  const key = normalizeTitle(t);
  return key.length >= 10 ? key : null;
}

// 発売日として使えるか: 掲載元のどこかに投稿された日（earliestPost）の 2 日後より遅い日付はありえない
// （再販・再掲載の日付や、別作品との取り違え）ので使わない
export function plausibleRelease(date, earliestPost) {
  if (!date) return false;
  if (!earliestPost) return true;
  return Date.parse(date.slice(0, 10)) <= Date.parse(earliestPost.slice(0, 10)) + 2 * 24 * 60 * 60 * 1000;
}

// ---- 公式の配信日（CK DOWNLOAD: COAT グループの公式配信サイト。CORS 可）----

// COAT グループの作品とみなすスタジオ・タグ（studioKey の形）
const CK_STUDIOS = new Set(['ckdownload', 'ck', 'coat', 'coatwest']);
// CK DOWNLOAD のプロダクトナンバーの形（CO-GF00025 / ORWESS127 / COCO351-05 / ANO-00184 など）
const CK_TOKEN = /^[A-Z]{2,8}-?[A-Z]{0,4}\d{2,6}(?:-\d{2})?$/i;
const CK_LEAD = /^\s*([A-Z]{2,8}-?[A-Z]{0,4}\d{2,6}(?:-\d{2})?)\s*[–\-:：]\s/i;

// CK DOWNLOAD で検索する品番の候補（COAT グループの作品でなければ空）。
// 検索は表記どおりの部分一致なので、掲載元の表記（タイトル先頭・タグ）→ 抽出した品番 の順に、最大 2 つ
export function ckCodes({ code, studio, tags = [], titles = [] }) {
  if (![studio, ...tags].some((t) => t && CK_STUDIOS.has(studioKey(t)))) return [];
  const out = [];
  const add = (c) => {
    if (!c) return;
    const u = c.trim().toUpperCase();
    if (CK_TOKEN.test(u) && !notCode(u) && !out.includes(u)) out.push(u);
  };
  for (const t of titles) add((t || '').match(CK_LEAD)?.[1]);
  add(code);
  for (const t of tags) add(t);
  return out.slice(0, 2);
}

// CK DOWNLOAD の検索結果ページ（/product/result?kw=…）から、件数と作品（id・タイトル・配信日）を取り出す。
// スマホ（iPhone）からはスマホ版（/sp/product/detail/…、タイトルが h3）が返るので、両方に対応する
export function parseCkResult(html) {
  const total = html.match(/<strong>([\d,]+)<\/strong>\s*件/);
  const list = html.match(/<ul class="title_list">([\s\S]*?)<\/ul>/);
  const items = [];
  if (list) {
    const re = /<a href="(?:\/sp)?\/product\/detail\/(\d+)">[\s\S]*?<h[34]>([\s\S]*?)<\/h[34]>[\s\S]*?<div class="date">(\d{4})\.(\d{2})\.(\d{2})<\/div>/g;
    for (const m of list[1].matchAll(re)) items.push({ id: m[1], title: m[2].trim(), date: `${m[3]}-${m[4]}-${m[5]}` });
  }
  return { total: total ? Number(total[1].replace(/,/g, '')) : null, items };
}
