// お気に入り
//
// 公開する関数（list.js / detail.js / main.js から使う。名前と引数は変えないこと）
//   init()              起動時に 1 回呼ばれる（IndexedDB の favs ストアから読み込む）。Promise を返す
//   isFav(key)          同期で真偽を返す（一覧の描画で大量に呼ばれるので、メモリの Map で引く）
//   toggleFav(video)    追加/解除。変わったら data.js の emit('favs') を呼ぶ。戻り値は追加後なら true
//   favButton(video)    詳細シートに置くハートボタン（HTMLElement）を返す
//
// 保存形式（favs ストア、keyPath: key）
//   { key, addedAt, title, thumb, code, studio }
//   一覧から消えた動画（サイトの削除・収集データの削除など）でも中身が分かるように、登録時の情報を持っておく
//
// 書き出しファイルの形式
//   { app: 'video-finder', type: 'favorites', version: 1, exportedAt, items: [行, …] }

import * as db from './db.js';
import { state, on, emit } from './data.js';
import { toast, esc } from './util.js';
import { registerSettingsSection } from './ui/settings.js';

const STORE = 'favs';
const rows = new Map(); // key -> 保存している行

export async function init() {
  try {
    for (const r of await db.getAll(STORE)) if (r && r.key) rows.set(r.key, r);
  } catch (err) {
    console.warn('お気に入りを読み込めませんでした', err);
  }
  // 登録時に欠けていた情報（サムネイルなど）を、いまの一覧にあれば補っておく
  on('data', fillMissing);
  fillMissing();
  registerSettingsSection({ id: 'favorites', title: 'お気に入り', render: renderSection });
}

export const isFav = (key) => rows.has(key);

// 動画オブジェクトから保存する行を作る
function toRow(video, addedAt = Date.now()) {
  return {
    key: video.key,
    addedAt,
    title: video.title || '',
    thumb: video.thumb || '',
    code: video.code || '',
    studio: video.studio || '',
  };
}

export async function toggleFav(video) {
  if (!video || !video.key) return false;
  const key = video.key;
  const before = rows.get(key);
  // 連打されても状態がずれないよう、メモリを先に変えてから保存する
  if (before) rows.delete(key); else rows.set(key, toRow(video));
  emit('favs');
  try {
    if (before) await db.del(STORE, key); else await db.put(STORE, rows.get(key));
  } catch (err) {
    // 保存に失敗したら元に戻す
    if (before) rows.set(key, before); else rows.delete(key);
    emit('favs');
    toast('お気に入りを保存できませんでした');
    throw err;
  }
  return !before;
}

export function favButton(video) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn fav-btn';
  // ラベルは固定にし、状態は aria-pressed と ♡/♥・色で示す（読み上げでは「お気に入り、オン/オフ」になる）
  b.innerHTML = '<span class="fav-heart" aria-hidden="true"></span><span class="fav-label">お気に入り</span>';
  const heart = b.querySelector('.fav-heart');
  const paint = () => {
    const on = isFav(video.key);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    heart.textContent = on ? '♥' : '♡';
  };
  paint();
  b.onclick = async () => {
    // 押した瞬間に見た目を変え、軽く弾ませる
    const p = toggleFav(video);
    paint();
    b.classList.remove('pop');
    void b.offsetWidth; // アニメーションを最初からやり直す
    b.classList.add('pop');
    try {
      const added = await p;
      toast(added ? 'お気に入りに追加しました' : 'お気に入りから外しました');
    } catch {
      paint();
    }
  };
  b.addEventListener('animationend', () => b.classList.remove('pop'));
  return b;
}

function fillMissing() {
  const changed = [];
  for (const r of rows.values()) {
    const v = state.byKey.get(r.key);
    if (!v) continue;
    let dirty = false;
    for (const f of ['title', 'thumb', 'code', 'studio']) {
      if (!r[f] && v[f]) { r[f] = v[f]; dirty = true; }
    }
    if (dirty) changed.push(r);
  }
  if (changed.length) db.putAll(STORE, changed).catch(() => {});
}

// ---- 設定画面のセクション ----

let sectionEl = null;

function renderSection(el) {
  sectionEl = el;
  el.innerHTML = `
    <div class="fav-count" data-role="count"></div>
    <div class="btn-row">
      <button class="btn" type="button" data-act="export">書き出し</button>
      <button class="btn" type="button" data-act="import">読み込み</button>
      <input type="file" accept="application/json,.json" data-role="file" hidden>
    </div>
    <p class="note fav-note">iPhone はしばらく開かないサイトのデータを消すことがあります。消えても戻せるよう、ときどき書き出してファイルに保存しておくと安心です。読み込みは今のお気に入りに足し合わせます（消えません）。</p>`;
  updateCount();
  const file = el.querySelector('[data-role="file"]');
  el.querySelector('[data-act="export"]').onclick = exportFavs;
  el.querySelector('[data-act="import"]').onclick = () => { file.value = ''; file.click(); };
  file.onchange = () => { if (file.files && file.files[0]) importFavs(file.files[0]); };
}

function updateCount() {
  if (!sectionEl || !sectionEl.isConnected) return;
  const total = rows.size;
  let missing = 0;
  for (const k of rows.keys()) if (!state.byKey.has(k)) missing++;
  sectionEl.querySelector('[data-role="count"]').innerHTML = total
    ? `<b>${total.toLocaleString()}</b> 件${missing ? `<span class="note">（うち一覧にない ${missing.toLocaleString()} 件）</span>` : ''}`
    : 'まだありません';
}
on('favs', updateCount);
on('data', updateCount);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function exportFavs() {
  if (!rows.size) return toast('お気に入りがまだありません');
  // share() はタップ直後に呼ぶ必要があるので、await を挟まずにメモリから作る
  const items = [...rows.values()].sort((a, b) => a.addedAt - b.addedAt);
  const json = JSON.stringify({ app: 'video-finder', type: 'favorites', version: 1, exportedAt: new Date().toISOString(), items }, null, 1);
  const name = `video-finder-favorites-${stamp()}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // iOS の Safari では共有シートの「"ファイル"に保存」がいちばん確実
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'お気に入りのバックアップ' });
      toast(`${items.length.toLocaleString()} 件を書き出しました`);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 共有シートを閉じただけ
      // それ以外はダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  toast(`${items.length.toLocaleString()} 件を書き出しました`);
}

// 読み込んだ 1 件を検査して、保存できる形にそろえる
function normalize(x) {
  if (!x || typeof x !== 'object' || typeof x.key !== 'string' || !x.key) return null;
  const s = (v) => (typeof v === 'string' ? v : '');
  const t = Number(x.addedAt);
  return {
    key: x.key,
    addedAt: Number.isFinite(t) && t > 0 ? t : Date.now(),
    title: s(x.title), thumb: s(x.thumb), code: s(x.code), studio: s(x.studio),
  };
}

async function importFavs(f) {
  let data;
  try {
    data = JSON.parse(await f.text());
  } catch {
    return alert('読み込めませんでした: JSON ファイルではありません');
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!list) return alert('読み込めませんでした: お気に入りの書き出しファイルではありません');

  const merged = [];
  let added = 0;
  for (const raw of list) {
    const r = normalize(raw);
    if (!r) continue;
    const cur = rows.get(r.key);
    if (!cur) {
      rows.set(r.key, r);
      merged.push(r);
      added++;
      continue;
    }
    // 既にあるものは、早いほうの登録日時を残し、空の項目だけ補う
    let dirty = false;
    if (r.addedAt < cur.addedAt) { cur.addedAt = r.addedAt; dirty = true; }
    for (const k of ['title', 'thumb', 'code', 'studio']) if (!cur[k] && r[k]) { cur[k] = r[k]; dirty = true; }
    if (dirty) merged.push(cur);
  }
  try {
    if (merged.length) await db.putAll(STORE, merged);
  } catch (err) {
    alert('保存できませんでした: ' + (err && err.message ? err.message : err));
    return;
  }
  fillMissing();
  emit('favs');
  toast(added ? `${added.toLocaleString()} 件を追加しました（合計 ${rows.size.toLocaleString()} 件）` : '新しく追加するお気に入りはありませんでした');
  if (sectionEl && sectionEl.isConnected) {
    const note = sectionEl.querySelector('.fav-note');
    if (note) note.insertAdjacentHTML('beforebegin', `<p class="note">${esc(f.name)} から ${added.toLocaleString()} 件を追加しました</p>`);
  }
}
