// 品番の抽出と、重複をまとめるための統合キー（DOM に依存しない純粋関数。node --test で検証する）

// 品番（例: MR-KR2387, GT-2720, SUPD-123）
export const CODE_RE = /\b([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})\b/i;

// 品番の形をしているが品番ではない一般的な語（Part-02 / Vol-01 / Best-of-2023 / COVID-19 など）
const NOT_CODE = /^(PART|PT|VOL|EP|EPS|EPISODE|SCENE|CHAPTER|CH|BEST|TOP|NO|NUM|COVID|FULLHD|FHD|HD|UHD|JAPAN|DAY|YEAR|SEASON|DISC|CD|DVD|MP|H|X|COLLECTION)\b/i;
const isYear = (digits) => /^(19|20)\d\d$/.test(digits);

function codeIn(text) {
  for (const m of text.matchAll(new RegExp(CODE_RE.source, 'gi'))) {
    const code = m[1];
    const digits = code.match(/(\d+)$/)[1];
    if (NOT_CODE.test(code) || /-OF-/i.test(code) || isYear(digits)) continue;
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
