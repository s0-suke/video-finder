// 発売日の推定（DOM に依存しない純粋関数。node --test で検証する）
//
// 同じレーベルの品番（GT-2719 / MR-KR2387 / OAV-123 など）は、番号の順にほぼ発売日順に並ぶ。
// そこで発売日が分かっている動画（公式・otokoki）を接頭辞ごとに番号順の点列にし、
// 分からない動画の発売日を、番号で前後に挟む既知の 2 点から線形補間する。
//
// 推定するのは次の条件をすべて満たすときだけ（全件データの交差検証で決めた。tests/release-estimate.test.js の冒頭も参照）
//   - 前後の両側に既知の点がある（外挿はしない）
//   - 前後の点の番号差が ESTIMATE.maxGap 以下
//   - 前後の点の日付が逆転しておらず、間が ESTIMATE.maxSpanDays 日以下（推定は必ずこの間に入るので、外れが小さい）
//   - その接頭辞の既知の点を番号順に並べたとき、日付が 30 日以上さかのぼる箇所の割合が ESTIMATE.maxInversion 以下
//     （番号と日付が逆転しがちなレーベル・複数のレーベルが同じ接頭辞を使っているものは使わない）
// 掲載元の最初の投稿日より遅い推定日は使わない（data.js で plausibleRelease を通す）。

export const ESTIMATE = { maxGap: 20, maxSpanDays: 60, maxInversion: 0.2 };

const DAY = 24 * 60 * 60 * 1000;
const INVERSION_DAYS = 30;

// 品番を「接頭辞（英字）＋番号」に分ける（MR-KR2387 → { prefix: 'MRKR', num: 2387 }）。形が合わなければ null
export function releaseSeries(code) {
  // ハイフンは英字の間・英字と番号の間だけ認める（COCO351-05 のような枝番付きは対象外）
  const m = code && String(code).trim().toUpperCase().match(/^([A-Z]+(?:-[A-Z]+)*)-?(\d{1,6})$/);
  const prefix = m && m[1].replace(/-/g, '');
  return m && prefix.length >= 2 && prefix.length <= 8 ? { prefix, num: Number(m[2]) } : null;
}

const toTime = (date) => Date.parse(String(date).slice(0, 10));
const toDate = (t) => new Date(t).toISOString().slice(0, 10);

// 既知の発売日（{ code, date } の並び）から、接頭辞ごとの点列を作る。
// 同じ番号が複数あるときはいちばん早い日付を使う。
// 戻り値: Map(接頭辞 -> { pts: [{ num, code, date, t }]（番号順）, inversion: 逆転の割合 })
export function buildEstimateIndex(points) {
  const by = new Map();
  for (const { code, date } of points) {
    const s = date && releaseSeries(code);
    if (!s) continue;
    const t = toTime(date);
    if (Number.isNaN(t)) continue;
    let m = by.get(s.prefix);
    if (!m) by.set(s.prefix, (m = new Map()));
    const prev = m.get(s.num);
    if (!prev || t < prev.t) m.set(s.num, { num: s.num, code, date: date.slice(0, 10), t });
  }
  const index = new Map();
  for (const [prefix, m] of by) {
    const pts = [...m.values()].sort((a, b) => a.num - b.num);
    let bad = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].t < pts[i - 1].t - INVERSION_DAYS * DAY) bad++;
    index.set(prefix, { pts, inversion: pts.length > 1 ? bad / (pts.length - 1) : 0 });
  }
  return index;
}

// 品番の発売日を推定する。推定できなければ null。
// 戻り値: { date: 'YYYY-MM-DD', from: { code, date }, to: { code, date } }（from / to が根拠にした前後の品番）
// その番号自体が既知の点にあるときも null（推定ではなく既知の日付を使うべきなので）
export function estimateRelease(index, code, opts = ESTIMATE) {
  const s = releaseSeries(code);
  const series = s && index.get(s.prefix);
  if (!series || series.inversion > opts.maxInversion) return null;
  const { pts } = series;
  // 番号が s.num 以上の最初の点（二分探索）
  let lo = 0, hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].num < s.num) lo = mid + 1; else hi = mid;
  }
  const a = pts[lo - 1], b = pts[lo];
  if (!a || !b || b.num === s.num) return null;
  if (b.num - a.num > opts.maxGap) return null;
  if (b.t < a.t || b.t - a.t > opts.maxSpanDays * DAY) return null;
  const t = a.t + ((b.t - a.t) * (s.num - a.num)) / (b.num - a.num);
  return {
    date: toDate(Math.round(t / DAY) * DAY),
    from: { code: a.code, date: a.date },
    to: { code: b.code, date: b.date },
  };
}
