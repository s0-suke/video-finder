// 一覧の、DOM に依存しない部分（純粋関数。tests/list-core.test.js で確かめる）
//
// - videoMatcher: キーワードに当たる動画の判定（全角半角・大文字小文字・品番のハイフンの有無を気にしない）
// - dayLabel: 履歴の日付の見出し（今日 / 昨日 / 11月3日（月） / 2025年11月3日（月））
// - shortDate: カードの短い日付（今年なら「11/04」、それ以外は「2021/05/23」）

import { normalizeCode } from './matching.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export const normalizeQuery = (s) => String(s || '').normalize('NFKC').toLowerCase();

/** キーワード（空白区切りで、すべてに当たる）に当たる動画かどうかを返す関数。キーワードが空なら常に true。動画は { hay, code } を持つ */
export function videoMatcher(q) {
  const words = normalizeQuery(q).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (v) => words.every((w) => v.hay.includes(w) || (v.code && /\d/.test(w) && normalizeCode(v.code).toLowerCase().includes(w.replace(/-/g, ''))));
}

/** 見た日の見出し。at: ミリ秒、now: 比べる時刻（省略したら現在） */
export function dayLabel(at, now = Date.now()) {
  const d = new Date(at), n = new Date(now);
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  const md = `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** カード用の短い日付（'2026-11-04T…' → 今年なら '11/04'、それ以外は '2021/05/23'）。空なら '' */
export function shortDate(d, now = Date.now()) {
  if (!d) return '';
  const year = String(new Date(now).getFullYear());
  return d.startsWith(year) ? d.slice(5, 10).replace('-', '/') : d.slice(0, 10).replace(/-/g, '/');
}
