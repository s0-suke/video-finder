// 品番の抽出と、重複をまとめるための統合キー（DOM に依存しない純粋関数。node --test で検証する）

// 品番（例: MR-KR2387, GT-2720, SUPD-123）
export const CODE_RE = /\b([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})\b/i;

// 品番の形をしているが品番ではない一般的な語（Part-02 / Vol-01 / Best-of-2023 / COVID-19 など）
const NOT_CODE = /^(PART|PT|VOL|EP|EPS|EPISODE|SCENE|CHAPTER|CH|BEST|TOP|NO|NUM|COVID|FULLHD|FHD|HD|UHD|JAPAN|DAY|YEAR|SEASON|DISC|CD|DVD|MP|H|X|COLLECTION)\b/i;
const isYear = (digits) => /^(19|20)\d\d$/.test(digits);

function codeIn(text) {
  for (const m of text.matchAll(new RegExp(CODE_RE.source, 'gi'))) {
    const code = m[1];
    if (NOT_CODE.test(code) || /-OF-/i.test(code)) continue;
    // 年に見える番号（1925 / 2024）は、接頭辞が 2〜4 文字の大文字のとき（GT-1925）だけ品番として扱う（Summer-2024 などを除く）
    if (isYear(code.match(/(\d+)$/)[1]) && !/^[A-Z]{2,4}-/.test(code)) continue;
    return code.toUpperCase();
  }
  return null;
}

export function extractCode(title, tags = []) {
  const fromTitle = codeIn(title);
  if (fromTitle) return fromTitle;
  for (const t of tags) {
    const mt = t.match(CODE_RE);
    if (mt && mt[0].length >= t.trim().length - 1) {
      const c = codeIn(t);
      if (c) return c;
    }
    // タグ全体がハイフンなしの品番（BWB383 など）なら、英字と数字の間にハイフンを補う（Japan2024 のような年は除く）
    const bare = t.trim().match(/^([A-Z]{2,5})(\d{3,5})$/i);
    if (bare && !isYear(bare[2]) && !NOT_CODE.test(bare[1])) return `${bare[1]}-${bare[2]}`.toUpperCase();
  }
  return null;
}

// タグが品番そのものか（表示用のタグから除く）
export const isCodeTag = (t) => extractCode('', [t]) !== null;

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
export const normalizeCode = (code) => code.replace(/-/g, '').toUpperCase();

// タイトル先頭の「品番 – 」を取り除く
export function stripCode(title, code) {
  if (!code) return title;
  const re = new RegExp('^\\s*' + code.replace(/-/g, '-?') + '\\s*[–\\-:：]?\\s*', 'i');
  return title.replace(re, '') || title;
}

export const normalizeTitle = (title) => title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// 品番がない動画は、記号・空白を除いたタイトルで統合する（短すぎるタイトルは誤統合を避けて統合しない）
export function groupKey(code, title, postKey) {
  if (code) return 'code:' + normalizeCode(code);
  const norm = normalizeTitle(title);
  return norm.length >= 10 ? 'title:' + norm : 'post:' + postKey;
}

// スタジオ名ではない分類・告知用のタグ（igay69 の [PORN] / [LEAK] / #NEW など）
export const isNoiseTag = (t) => /^\[.*\]$|^#|^(AAA|uncategorized|未分類)$/i.test(t.trim());

// スタジオ名はタグ側（品番・分類タグ以外）を優先、なければカテゴリ
export function pickStudio(tags, cats) {
  const ok = (t) => !CODE_RE.test(t) && !isNoiseTag(t);
  return tags.find(ok) || cats.find(ok) || null;
}

// 表記ゆれのあるスタジオ名（MEN'S RUSH.TV / Men's Rush.TV / Men’s Rush.TV）を同じものとして扱うためのキー
export const studioKey = (name) => normalizeTitle(name || '');

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
    if (CK_TOKEN.test(u) && !NOT_CODE.test(u) && !out.includes(u)) out.push(u);
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
