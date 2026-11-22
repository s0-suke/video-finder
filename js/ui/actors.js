// 出演者の画面
//
// - 出演者タブ（#actors）: 正方形の写真を 2 列に並べたグリッド。名前・特徴での検索、体型・特徴タグ・名前あり・お気に入りでの絞り込み、並び順
// - mountActorGrid: そのグリッドの部品（お気に入りのタブの「出演者」でも使う）
// - 詳細ページ（#actor/<id>）: 写真・別名・身長/体重/年齢・タグ・出演作
// - 写真は、一覧に出てきたカードから少しずつ取る（actors.js の enrich。出演作のアイキャッチ画像）。自分で登録した写真が優先
// - お気に入りは actors.js の isFavActor / toggleFavActor。♥ を押すと全部の画面の ♥ が合う（'favactors' イベント）

import { $, esc, toast } from '../util.js';
import { on } from '../data.js';
import { actorSummary } from '../actors-core.js';
import {
  allActors, getActor, searchActors, enrich, videosOf, ageOf, isFavActor, toggleFavActor, setCustom, photoOf,
  syncIndex, loadTagList, actorsWithTag,
} from '../actors.js';
import { openDetail } from './detail.js';
import { bindSearch } from './feed.js';
import { showHome } from './home.js';

const PAGE = 40;
const initial = (a) => (a.display || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1) || '?';

/** 出演者のページへ移る直前のページ（'#actors' / '#favs' / '#home' など）。戻る先と、どのタブを選んだ表示にするかに使う */
export let actorFrom = '#actors';

/** 出演者のページへ移る（タブの切り替えと同じく、履歴に積まない） */
export function gotoActor(id) {
  if (!/^#actor\//.test(location.hash)) actorFrom = location.hash || '#actors';
  history.replaceState(history.state, '', `${location.pathname}${location.search}#actor/${id}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export const actorIdFromHash = () => {
  const m = location.hash.match(/^#actor\/(\d+)$/);
  return m ? +m[1] : null;
};

// ───────────── グリッドの部品 ─────────────

const photoHTML = (a) => {
  const photo = photoOf(a);
  return photo ? `<img src="${esc(photo)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<span class="av-ph">${esc(initial(a))}</span>`;
};

const heartHTML = (a) => {
  const f = isFavActor(a.id);
  return `<button class="heart-btn ${f ? 'on' : ''}" type="button" data-fav-actor="${a.id}" aria-pressed="${f}" aria-label="${esc(a.display)}をお気に入り${f ? 'から外す' : 'にする'}">${f ? '♥' : '♡'}</button>`;
};

function cardInfo(a) {
  const sum = actorSummary({ ...a, age: ageOf(a) });
  return [sum || a.descriptor || a.label, `${a.count.toLocaleString()} 本`].filter(Boolean).join(' · ');
}

/** グリッドの 1 枚 */
export function actorCardHTML(a) {
  return `<div class="ag-card" data-actor="${a.id}" role="button" tabindex="0">
    <div class="ag-photo" data-av="${a.id}">${photoHTML(a)}${heartHTML(a)}</div>
    <div class="ag-name">${esc(a.display)}</div>
    <div class="ag-sub">${esc(cardInfo(a))}</div>
  </div>`;
}

/** 取れた写真・情報に、カードを合わせる（カードごと作り直さない） */
function refreshCard(root, a) {
  const card = root.querySelector(`.ag-card[data-actor="${a.id}"]`);
  if (!card) return;
  const ph = card.querySelector('.ag-photo');
  const photo = photoOf(a);
  if (photo && !ph.querySelector('img')) { ph.querySelector('.av-ph')?.remove(); ph.insertAdjacentHTML('afterbegin', photoHTML(a)); }
  card.querySelector('.ag-sub').textContent = cardInfo(a);
}

// 見えているカードのプロフィールを、2 つずつ取る（取りすぎて otokoki に負担をかけない。いま見えているものから先に）
const queue = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const { id, done } = queue.pop();
    running++;
    enrich(id, 'brief').then((a) => done(a)).catch(() => {}).finally(() => { running--; pump(); });
  }
}
const queued = new Set();
function lazyEnrich(id, done) {
  if (queued.has(id)) return;
  const a = getActor(id);
  if (!a || (a.profile && Date.now() - a.profile.at < 14 * 24 * 60 * 60 * 1000)) return;
  queued.add(id);
  queue.push({ id, done });
  pump();
}

function onHeart(id) {
  const a = getActor(id);
  const added = toggleFavActor(id);
  toast(added ? `♥ ${a ? a.display : ''} をお気に入りにしました` : `${a ? a.display : ''} をお気に入りから外しました`);
}

function syncHearts(root) {
  for (const b of root.querySelectorAll('[data-fav-actor]')) {
    const f = isFavActor(+b.dataset.favActor);
    b.classList.toggle('on', f);
    b.textContent = f ? '♥' : '♡';
    b.setAttribute('aria-pressed', String(f));
  }
}

/** container にグリッドを作る。返り値: { setRows(出演者の配列, 0 件のときの案内) }。スクロールで続きを足し、見えたカードの写真を取る */
export function mountActorGrid(container) {
  let rows = [];
  let shown = 0;
  const grid = document.createElement('div');
  grid.className = 'actor-grid';
  const empty = document.createElement('div');
  empty.className = 'state hidden';
  const sentinel = document.createElement('div');
  sentinel.style.height = '1px';
  container.replaceChildren(grid, empty, sentinel);

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      if (e.target === sentinel) { more(); continue; }
      io.unobserve(e.target);
      lazyEnrich(+e.target.dataset.actor, (a) => refreshCard(grid, a));
    }
  }, { rootMargin: '400px' });
  const more = () => {
    if (!grid.offsetParent) return;
    const next = rows.slice(shown, shown + PAGE);
    if (!next.length) return;
    grid.insertAdjacentHTML('beforeend', next.map(actorCardHTML).join(''));
    for (const el of [...grid.querySelectorAll('.ag-card')].slice(shown, shown + next.length)) io.observe(el);
    shown += next.length;
  };
  io.observe(sentinel);

  grid.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-fav-actor]');
    if (heart) { e.stopPropagation(); return onHeart(+heart.dataset.favActor); }
    const card = e.target.closest('.ag-card');
    if (card) gotoActor(+card.dataset.actor);
  });
  grid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ag-card')) { e.preventDefault(); gotoActor(+e.target.dataset.actor); }
  });
  // ♥ が変わったら（別の画面でも）、この一覧の ♥ だけ合わせる（並びはそのまま。押したカードが動かないように）
  on('favactors', () => { if (grid.isConnected) syncHearts(grid); });

  return {
    setRows(next, emptyText = '見つかりません') {
      rows = next;
      shown = 0;
      grid.innerHTML = '';
      empty.classList.toggle('hidden', rows.length > 0);
      empty.innerHTML = emptyText;
      more();
    },
    count: () => rows.length,
  };
}

// ───────────── 出演者タブ（#actors） ─────────────

const AF_KEY = 'actorFilters';
const af = (() => { try { return { mode: 'all', tag: 0, sort: 'count', ...JSON.parse(localStorage.getItem(AF_KEY) || '{}') }; } catch { return { mode: 'all', tag: 0, sort: 'count' }; } })();
if (!['all', 'fav', 'named'].includes(af.mode)) af.mode = 'all';
af.q = '';
const saveAf = () => { try { const { q, ...rest } = af; localStorage.setItem(AF_KEY, JSON.stringify(rest)); } catch { /* 保存できなくても動く */ } };

let actorsGrid = null;
let tags = [];
let tagSet = null; // 選んだタグの付いた作品の出演者 id（取得中は null）
let tagBusy = 0; // 取得の通し番号（選び直したら古い取得の結果は捨てる）
let dirty = true;

function computeActors() {
  let r = searchActors(af.q, { minCount: 1 });
  if (af.mode === 'fav') r = r.filter((a) => isFavActor(a.id));
  if (af.mode === 'named') r = r.filter((a) => !a.anonymous); // 「172cm60kg20歳」のような名前のない出演者を除く
  if (af.tag && tagSet) r = r.filter((a) => tagSet.has(a.id));
  if (af.sort === 'name') r = [...r].sort((a, b) => a.display.localeCompare(b.display, 'ja'));
  return r;
}

function renderActorChips() {
  const chip = (f, attrs, label) => `<button class="chip ${f ? 'on' : ''}" ${attrs}>${label}</button>`;
  $('#actors-chips').innerHTML =
    chip(af.mode === 'all' && !af.tag, 'data-reset', 'すべて') +
    chip(af.mode === 'fav', 'data-mode="fav"', '♥ お気に入り') +
    chip(af.mode === 'named', 'data-mode="named"', '名前あり') +
    tags.map((t) => chip(af.tag === t.id, `data-tag="${t.id}"`, esc(t.name))).join('');
  const on = $('#actors-chips .chip.on:not([data-reset])');
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderActorList() {
  dirty = false;
  const rows = computeActors();
  const loadingTag = af.tag && !tagSet;
  renderActorChips();
  $('#actors-meta').innerHTML = `<span>${loadingTag ? '調べています…' : `${rows.length.toLocaleString()} 人`}</span>` +
    `<button class="cond" data-sort>並び順: ${af.sort === 'name' ? '名前順' : '作品数順'}</button>`;
  actorsGrid.setRows(loadingTag ? [] : rows, !allActors().length ? '' : af.mode === 'fav' ? 'お気に入りの出演者はまだいません。出演者の ♡ を押すと追加されます' : '見つかりません');
}

async function pickTag(id) {
  af.tag = af.tag === id ? 0 : id;
  tagSet = null;
  saveAf();
  const mine = ++tagBusy;
  if (!af.tag) { tagSet = null; return renderActorList(); }
  renderActorList();
  try {
    const set = await actorsWithTag(af.tag);
    if (mine !== tagBusy) return;
    tagSet = set;
  } catch {
    if (mine !== tagBusy) return;
    toast('通信できませんでした。あとでもう一度お試しください');
    af.tag = 0; saveAf();
  }
  renderActorList();
}

function initActors() {
  actorsGrid = mountActorGrid($('#actors-list'));
  bindSearch($('#aq'), $('#aq-clear'), (q) => { af.q = q; renderActorList(); });
  $('#actors-chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.reset !== undefined) { Object.assign(af, { mode: 'all', tag: 0 }); tagSet = null; tagBusy++; saveAf(); return renderActorList(); }
    if (b.dataset.mode) { af.mode = af.mode === b.dataset.mode ? 'all' : b.dataset.mode; saveAf(); return renderActorList(); }
    if (b.dataset.tag) pickTag(+b.dataset.tag);
  };
  $('#actors-meta').onclick = (e) => {
    if (!e.target.closest('[data-sort]')) return;
    af.sort = af.sort === 'name' ? 'count' : 'name';
    saveAf();
    renderActorList();
  };
  on('actors', () => { if (location.hash !== '#actors') dirty = true; });
  tags = [];
  loadTagList().then((rows) => { tags = rows; if (location.hash === '#actors') renderActorChips(); }).catch(() => {});
  // 選んでいたタグがあれば、その出演者を取り直す
  if (af.tag) { const id = af.tag; af.tag = 0; pickTag(id); }
}

/** タブを開いたとき（route から） */
export function openActors() {
  if (!actorsGrid) initActors();
  const empty = !allActors().length;
  if (empty) {
    const note = $('#actors-note');
    note.textContent = '出演者の一覧を取得しています…（初回だけ）';
    note.classList.remove('hidden');
    syncIndex({ onProgress: (n) => { note.textContent = `出演者の一覧を取得しています… ${n.toLocaleString()} 人`; } })
      .then(() => { note.classList.add('hidden'); if (location.hash === '#actors') renderActorList(); })
      .catch(() => { note.textContent = '通信できませんでした。あとでもう一度開いてください'; });
  } else {
    syncIndex().catch(() => {}); // 古ければ（7 日）裏で更新
  }
  if (dirty || empty || !actorsGrid.count()) renderActorList(); else renderActorChips();
}

// ───────────── 詳細ページ ─────────────

const PER_ROW_GRID = 60;

/** #actor/<id> を描く（route から）。取得中は、いまある情報で先に描き、取れたら描き直す */
export function renderActorPage(id) {
  const root = $('#view-actor-body');
  const a = getActor(id);
  if (!a) {
    root.innerHTML = '<div class="state">出演者が見つかりません</div>';
    return;
  }
  const draw = (cur) => {
    const p = cur.profile || {};
    const age = ageOf(cur);
    const attrs = [cur.height ? `${cur.height}cm` : '', cur.weight ? `${cur.weight}kg` : '', age ? `${age}歳${cur.age ? '' : '（作品名から）'}` : ''].filter(Boolean);
    const vids = videosOf(cur);
    root.innerHTML = `
      <div class="ap-head">
        <span class="av av-lg" data-av="${cur.id}">${photoHTML(cur)}</span>
        <div class="ap-title">
          <h1>${esc(cur.display)}</h1>
          ${cur.aliases.length > 1 ? `<div class="ap-alias">別名: ${esc(cur.aliases.filter((x) => x !== cur.display).join(' / '))}</div>` : ''}
          ${cur.label ? `<div class="ap-alias">${esc(cur.label)}</div>` : ''}
        </div>
        ${heartHTML(cur)}
      </div>
      <div class="ap-attrs">
        ${attrs.length ? attrs.map((t) => `<span class="ap-attr">${esc(t)}</span>`).join('') : '<span class="note">身長・体重・年齢の情報はありません</span>'}
        ${cur.descriptor ? `<span class="ap-attr soft">${esc(cur.descriptor)}</span>` : ''}
      </div>
      ${(p.tags && p.tags.length) ? `<div class="ap-tags">${p.tags.map((t) => `<span class="dt-chip">${esc(t.name)}<small> ${t.n}</small></span>`).join('')}</div>` : ''}
      <div class="ap-stats">
        <span><b>${cur.count.toLocaleString()}</b> 本 <small>otokoki の出演作</small></span>
        <span><b>${vids.length.toLocaleString()}</b> 本 <small>手元の動画</small></span>
        ${p.latest ? `<span><small>最新の出演作</small> ${esc(p.latest.slice(0, 10).replace(/-/g, '/'))}</span>` : ''}
      </div>
      <div class="ap-links">
        <button class="btn" type="button" data-act="search-words">名前で動画を探す</button>
        ${cur.link ? `<a class="btn" href="${esc(cur.link)}" target="_blank" rel="noopener noreferrer">otokoki で見る ↗</a>` : ''}
        <button class="btn ghost" type="button" data-act="set-photo">写真を設定</button>
        ${cur.custom && cur.custom.photo ? '<button class="btn ghost" type="button" data-act="clear-photo">写真を外す</button>' : ''}
        <input type="file" accept="image/*" id="ap-file" hidden>
      </div>
      <div class="section-title">手元の出演作</div>
      ${p.full ? '' : '<div class="note" id="ap-loading">出演作を照合しています…</div>'}
      <div class="grid" id="ap-grid">${vids.slice(0, PER_ROW_GRID).map((v, i) => workCardHTML(v, i)).join('')}</div>
      ${p.full && !vids.length ? '<div class="state">手元の動画に、この人の出演作は見つかりませんでした。「名前で動画を探す」を試してください</div>' : ''}
      ${vids.length > PER_ROW_GRID ? `<div class="state"><small>先頭の ${PER_ROW_GRID} 本を表示（全 ${vids.length.toLocaleString()} 本）</small></div>` : ''}
    `;
    root.dataset.id = String(cur.id);
    root._vids = vids;
  };
  draw(a);
  // 出演作の照合材料と、代表画像・タグを取って描き直す
  enrich(id, 'full').then((cur) => { if (cur && actorIdFromHash() === id) draw(cur); }).catch(() => {
    const l = $('#ap-loading');
    if (l) l.textContent = '通信できませんでした。あとでもう一度開いてください';
  });
}

function workCardHTML(v, i) {
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
    </div>
    <div class="title">${esc(v.title)}</div>
  </button>`;
}

/** 選んだ画像を 256px 四方（中央切り抜き）の JPEG にして data URL で返す */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const n = Math.min(bmp.width, bmp.height), S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.getContext('2d').drawImage(bmp, (bmp.width - n) / 2, (bmp.height - n) / 2, n, n, 0, 0, S, S);
  return c.toDataURL('image/jpeg', 0.85);
}

export function initActorPage({ onBack }) {
  const root = $('#view-actor-body');
  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'ap-file' || !e.target.files[0]) return;
    try { await setCustom(+root.dataset.id, { photo: await shrink(e.target.files[0]) }); } catch { toast('画像を読み込めませんでした'); }
    renderActorPage(+root.dataset.id);
  });
  root.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-fav-actor]');
    if (heart) return onHeart(+heart.dataset.favActor);
    if (e.target.closest('[data-act="set-photo"]')) return $('#ap-file').click();
    if (e.target.closest('[data-act="clear-photo"]')) return setCustom(+root.dataset.id, { photo: '' }).then(() => renderActorPage(+root.dataset.id));
    if (e.target.closest('[data-act="search-words"]')) {
      const a = getActor(+root.dataset.id);
      if (a) showHome({ q: a.aliases.find((x) => x.length >= 2) || a.display });
      return;
    }
    const card = e.target.closest('.card');
    if (card && root._vids) openDetail(root._vids[+card.dataset.i], { list: root._vids, index: +card.dataset.i });
  });
  $('#actor-back').onclick = onBack;
  on('favactors', () => syncHearts(root));
}
