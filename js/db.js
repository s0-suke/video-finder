// IndexedDB の薄いラッパー
//
// ストア一覧
//   sites    収集対象サイト        keyPath: id（自動採番）
//   posts    各サイトの投稿         keyPath: key（`${siteId}:${postId}`）、index: site
//   terms    タグ・カテゴリ名       keyPath: key（`${siteId}:${termId}`）
//   kv       設定などの単純な値     キーは自由
//   favs     お気に入り             keyPath: key（統合キー = video.key）
//   history  視聴履歴               keyPath: key（統合キー）
//   details  外部サイトの詳細情報のキャッシュ  keyPath: key（統合キー）
//   release  発売日の目安用の otokoki 記事（id・日付・品番・タイトルキー）  keyPath: id

const DB_NAME = 'video-finder';
const DB_VERSION = 3;

let db;

export function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const d = r.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('sites', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('posts', { keyPath: 'key' }).createIndex('site', 'siteId');
        d.createObjectStore('terms', { keyPath: 'key' });
        d.createObjectStore('kv');
      }
      if (e.oldVersion < 2) {
        d.createObjectStore('favs', { keyPath: 'key' });
        d.createObjectStore('history', { keyPath: 'key' });
        d.createObjectStore('details', { keyPath: 'key' });
      }
      if (e.oldVersion < 3) {
        d.createObjectStore('release', { keyPath: 'id' });
      }
    };
    r.onsuccess = () => {
      db = r.result;
      // 別のタブで新しい版が開かれたら、こちらの接続を閉じて相手の更新を妨げない
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    // 古い版を開いたままのタブがあると更新が待たされる
    r.onblocked = () => console.warn('ほかのタブで古い版が開いています。閉じると更新が進みます');
  });
}

export const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
export const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const getAll = (name) => req(store(name).getAll());
export const get = (name, key) => req(store(name).get(key));
export const put = (name, row) => req(store(name, 'readwrite').put(row));
export const del = (name, key) => req(store(name, 'readwrite').delete(key));
export const clear = (name) => req(store(name, 'readwrite').clear());

export function putAll(name, rows) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(name, 'readwrite');
    const s = t.objectStore(name);
    for (const row of rows) s.put(row);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存が中断されました（容量不足の可能性）'));
  });
}

export async function deleteByIndex(name, index, value) {
  const s = store(name, 'readwrite');
  const keys = await req(s.index(index).getAllKeys(value));
  for (const k of keys) s.delete(k);
}

export const kvGet = (k, def) => req(store('kv').get(k)).then((v) => (v === undefined ? def : v));
export const kvSet = (k, v) => req(store('kv', 'readwrite').put(v, k));
