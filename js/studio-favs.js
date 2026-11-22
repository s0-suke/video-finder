// お気に入りのスタジオ（ホームの「お気に入り」の絞り込みに使う）
//
// localStorage の vfFavStudios（{ スタジオの key: 名前 }）。読むたびに取る（数が少ないので軽い）。
// 付け外しは、スタジオ一覧のシート（ui/filters.js）とホームの条件の行から。変わったら 'favstudios' を送る。

import { emit } from './data.js';
import { normalizeNameMap, mergeNameMaps } from './backup-core.js';

const KEY = 'vfFavStudios';

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };

export const favStudioKeys = () => Object.keys(load());
export const isFavStudio = (key) => key in load();

/** 付けたら true */
export function toggleFavStudio(key, name = key) {
  const favs = load();
  const on = !(key in favs);
  if (on) favs[key] = name; else delete favs[key];
  try { localStorage.setItem(KEY, JSON.stringify(favs)); } catch { /* 保存できなくても、このあいだは効かない */ }
  emit('favstudios', key);
  return on;
}

/** 書き出し用: お気に入りのスタジオ { key: 名前 } */
export const favStudiosMap = () => load();

/** 読み込み: お気に入りのスタジオに足し合わせる。足した件数を返す */
export function importFavStudios(obj) {
  const { merged, added } = mergeNameMaps(load(), normalizeNameMap(obj));
  if (added) {
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { return 0; }
    emit('favstudios');
  }
  return added;
}
