// 品番の抽出と、重複をまとめるための統合キー（DOM に依存しない純粋関数。node --test で検証する）

// 品番（例: MR-KR2387, GT-2720, SUPD-123）
export const CODE_RE = /\b([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})\b/i;

export function extractCode(title, tags = []) {
  const m = title.match(CODE_RE);
  if (m) return m[1].toUpperCase();
  for (const t of tags) {
    const mt = t.match(CODE_RE);
    if (mt && mt[0].length >= t.trim().length - 1) return mt[1].toUpperCase();
    // タグ全体がハイフンなしの品番（BWB383 など）なら、英字と数字の間にハイフンを補う
    const bare = t.trim().match(/^([A-Z]{2,6})(\d{3,6})$/i);
    if (bare) return `${bare[1]}-${bare[2]}`.toUpperCase();
  }
  return null;
}

// タグが品番そのものか（表示用のタグから除く）
export const isCodeTag = (t) => CODE_RE.test(t) || /^[A-Z]{2,6}\d{3,6}$/i.test(t.trim());

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
