// バックアップの、DOM に依存しない部分（純粋関数。tests/backup-core.test.js で確かめる）
//
// 書き出しファイル（設定の「お気に入り」）の形:
//   { app: 'video-finder', type: 'favorites', version: 2, exportedAt,
//     items: [お気に入りの動画の行], actors: { 出演者 id: 名前 }, studios: { スタジオ key: 名前 }, history: [履歴の行] }
// version 1（動画だけ）のファイルも読める。読み込みは今の内容に足し合わせる（消えない）。

const str = (v) => (typeof v === 'string' ? v : '');

/** { キー: 名前 } を検査して、文字列のキーと名前だけにそろえる（壊れた値は捨てる） */
export function normalizeNameMap(obj, { numericKeys = false } = {}) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!k || (numericKeys && !/^\d+$/.test(k))) continue;
    out[k] = str(v) || k;
  }
  return out;
}

/** いまの { キー: 名前 } に、読み込んだ分を足す（既にあるものは残す）。返り値: { merged, added（足した件数） } */
export function mergeNameMaps(current, incoming) {
  const merged = { ...current };
  let added = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in merged)) { merged[k] = v; added++; }
  }
  return { merged, added };
}

/** 履歴の 1 行を検査して、保存できる形にそろえる。使えなければ null */
export function normalizeHistoryRow(x) {
  if (!x || typeof x !== 'object' || typeof x.key !== 'string' || !x.key) return null;
  const at = Number(x.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  return {
    key: x.key,
    at,
    title: str(x.title), thumb: str(x.thumb), code: str(x.code),
    posts: Array.isArray(x.posts) ? x.posts.filter((k) => typeof k === 'string').slice(0, 50) : [],
  };
}

/** 履歴に読み込んだ行を足す。同じ動画は新しい見た日時のほうを残す。返り値: { rows（保存し直す行）, added（新しく入った件数） } */
export function mergeHistory(current, incoming, max = 300) {
  const byKey = new Map(current.map((r) => [r.key, r]));
  const changed = [];
  let added = 0;
  for (const raw of incoming) {
    const r = normalizeHistoryRow(raw);
    if (!r) continue;
    const cur = byKey.get(r.key);
    if (!cur) { byKey.set(r.key, r); changed.push(r); added++; }
    else if (r.at > cur.at) { byKey.set(r.key, { ...cur, at: r.at }); changed.push(byKey.get(r.key)); }
  }
  // 上限を超えたぶん（古い順）は入れない
  const keep = new Set([...byKey.values()].sort((a, b) => b.at - a.at).slice(0, max).map((r) => r.key));
  return { rows: changed.filter((r) => keep.has(r.key)), added: changed.filter((r) => keep.has(r.key) && !current.some((c) => c.key === r.key)).length };
}
