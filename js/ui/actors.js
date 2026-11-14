// 出演者の画面（一覧の行・一覧・詳細ページ・お気に入りの出演者）
//
// - actorRowHTML / mountActorList: 検索タブの「出演者」と、お気に入りの出演者で使う一覧。行 = 代表画像・名前・体型・作品数・♥
// - openActorPage / renderActorPage: #actor/<id> の詳細ページ（代表画像・別名・身長/体重/年齢・タグ・出演作・otokoki へのリンク）
// - 代表画像・タグは、一覧に出てきた行から少しずつ取る（actors.js の enrich）。詳細を開いたときは出演作の照合材料も取る
// - お気に入りは actors.js の isFavActor / toggleFavActor。♥ を押すと全部の画面の ♥ が合う（'favactors' イベント）

import { $, esc, toast } from '../util.js';
import { on } from '../data.js';
import { actorSummary } from '../actors-core.js';
import { allActors, getActor, searchActors, enrich, videosOf, ageOf, isFavActor, favActorIds, toggleFavActor } from '../actors.js';
import { openDetail } from './detail.js';

const PAGE = 50;
const initial = (a) => (a.display || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1) || '?';

/** 出演者のページへ移る直前のページ（'#home' / '#search' / '#favactors' など）。戻る先と、どのタブを選んだ表示にするかに使う */
export let actorFrom = '#search';

/** 出演者のページへ移る（タブの切り替えと同じく、履歴に積まない） */
export function gotoActor(id) {
  if (!/^#actor\//.test(location.hash)) actorFrom = location.hash === '' ? (location.hash || '#search') : location.hash;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#actor/${id}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export const actorIdFromHash = () => {
  const m = location.hash.match(/^#actor\/(\d+)$/);
  return m ? +m[1] : null;
};

// ───────────── 部品 ─────────────

const avatarHTML = (a) => {
  const photo = a.profile && a.profile.photo;
  return `<span class="av" data-av="${a.id}">${photo ? `<img src="${esc(photo)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<span class="av-ph">${esc(initial(a))}</span>`}</span>`;
};

const heartHTML = (a) => {
  const on = isFavActor(a.id);
  return `<button class="heart-btn ${on ? 'on' : ''}" type="button" data-fav-actor="${a.id}" aria-pressed="${on}" aria-label="${esc(a.display)}をお気に入り${on ? 'から外す' : 'にする'}">${on ? '♥' : '♡'}</button>`;
};

/** 一覧の 1 行 */
export function actorRowHTML(a) {
  const sum = actorSummary({ ...a, age: ageOf(a) });
  const sub = [sum, a.descriptor, a.label ? `${a.label}` : ''].filter(Boolean).join(' · ');
  const tags = ((a.profile && a.profile.tags) || []).slice(0, 3).map((t) => t.name).join(' ・ ');
  return `<div class="actor-row" data-actor="${a.id}" role="button" tabindex="0">
    ${avatarHTML(a)}
    <span class="ar-main">
      <span class="ar-name">${esc(a.display)}</span>
      ${sub ? `<small class="ar-sub">${esc(sub)}</small>` : ''}
      ${tags ? `<small class="ar-tags">${esc(tags)}</small>` : ''}
    </span>
    <span class="ar-n">${a.count.toLocaleString()}<small>本</small></span>
    ${heartHTML(a)}
  </div>`;
}

/** 行の代表画像・タグを、取れたものから差し替える（行ごと作り直さない） */
function refreshRow(root, a) {
  const row = root.querySelector(`.actor-row[data-actor="${a.id}"]`);
  if (!row) return;
  const av = row.querySelector('.av');
  const photo = a.profile && a.profile.photo;
  if (photo && av && !av.querySelector('img')) av.innerHTML = `<img src="${esc(photo)}" loading="lazy" referrerpolicy="no-referrer" alt="">`;
  const tmp = document.createElement('div');
  tmp.innerHTML = actorRowHTML(a);
  const fresh = tmp.firstElementChild;
  const main = row.querySelector('.ar-main');
  if (main) main.innerHTML = fresh.querySelector('.ar-main').innerHTML;
}

// 見えている行のプロフィールを、2 つずつ順に取る（取りすぎて otokoki に負担をかけない）
const queue = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const { id, done } = queue.shift();
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

/**
 * 出演者の一覧を container に作る。opts: { ids（この id だけ。なければ全員）, query, sort: 'count'|'name', favOnly, minCount }
 * 返り値の update(opts) で、条件を変えて作り直す。スクロールで続きを足し、見えた行の代表画像を取る。
 */
export function mountActorList(container, initialOpts = {}) {
  let opts = { sort: 'count', minCount: 1, ...initialOpts };
  let rows = [];
  let shown = 0;
  const list = document.createElement('div');
  list.className = 'actor-list';
  const sentinel = document.createElement('div');
  sentinel.style.height = '1px';
  const empty = document.createElement('div');
  empty.className = 'state hidden';
  container.replaceChildren(list, empty, sentinel);

  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      if (e.target === sentinel) { more(); continue; }
      io.unobserve(e.target);
      lazyEnrich(+e.target.dataset.actor, (a) => refreshRow(list, a));
    }
  }, { rootMargin: '400px' });

  const build = () => {
    let r = opts.ids ? opts.ids.map(getActor).filter(Boolean) : searchActors(opts.query, { minCount: opts.minCount });
    if (opts.ids && opts.query) { const w = opts.query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean); r = r.filter((a) => w.every((x) => a.hay.includes(x))); }
    if (opts.favOnly) r = r.filter((a) => isFavActor(a.id));
    if (opts.sort === 'name') r = [...r].sort((a, b) => a.display.localeCompare(b.display, 'ja'));
    // お気に入りを先頭に（作品数順・名前順のどちらでも）
    const favs = r.filter((a) => isFavActor(a.id));
    rows = favs.length && !opts.favOnly ? [...favs, ...r.filter((a) => !isFavActor(a.id))] : r;
  };
  const more = () => {
    const next = rows.slice(shown, shown + PAGE);
    if (!next.length) return;
    list.insertAdjacentHTML('beforeend', next.map(actorRowHTML).join(''));
    for (const el of [...list.querySelectorAll('.actor-row')].slice(shown, shown + next.length)) io.observe(el);
    shown += next.length;
  };
  const paint = () => {
    list.innerHTML = '';
    shown = 0;
    build();
    empty.classList.toggle('hidden', rows.length > 0);
    empty.textContent = opts.emptyText || (allActors().length ? '見つかりません' : '出演者を取得しています…');
    more();
  };
  io.observe(sentinel);

  list.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-fav-actor]');
    if (heart) { e.stopPropagation(); return onHeart(+heart.dataset.favActor); }
    const row = e.target.closest('.actor-row');
    if (row) gotoActor(+row.dataset.actor);
  });
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.actor-row')) { e.preventDefault(); gotoActor(+e.target.dataset.actor); }
  });
  // ♥ が変わったら（別の画面でも）、この一覧の ♥ だけ合わせる（並びはそのまま。押した行が動かないように）
  // （on は解除できないので、この一覧の要素が画面から外れていたら何もしない）
  on('favactors', () => { if (list.isConnected) syncHearts(list); });
  paint();
  return {
    update(next) { opts = { ...opts, ...next }; paint(); },
    destroy() { io.disconnect(); },
    count: () => rows.length,
  };
}

function onHeart(id) {
  const a = getActor(id);
  const added = toggleFavActor(id);
  toast(added ? `♥ ${a ? a.display : ''} をお気に入りにしました` : `${a ? a.display : ''} をお気に入りから外しました`);
}

function syncHearts(root) {
  for (const b of root.querySelectorAll('[data-fav-actor]')) {
    const on = isFavActor(+b.dataset.favActor);
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
    b.setAttribute('aria-pressed', String(on));
  }
}

// ───────────── 詳細ページ ─────────────

const PER_ROW_GRID = 60;

/** #actor/<id> を描く（route から）。取得中は、いまある情報で先に描き、取れたら描き直す */
export function renderActorPage(id) {
  const root = $('#view-actor-body');
  const a = getActor(id);
  if (!a) {
    root.innerHTML = `<div class="state">出演者が見つかりません。<div class="btn-row" style="justify-content:center"><button class="btn" data-act="to-search">検索に戻る</button></div></div>`;
    return;
  }
  const draw = (cur) => {
    const p = cur.profile || {};
    const age = ageOf(cur);
    const attrs = [cur.height ? `${cur.height}cm` : '', cur.weight ? `${cur.weight}kg` : '', age ? `${age}歳${cur.age ? '' : '（作品名から）'}` : ''].filter(Boolean);
    const vids = videosOf(cur);
    root.innerHTML = `
      <div class="ap-head">
        ${avatarHTML(cur).replace('class="av"', 'class="av av-lg"')}
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

export function initActorPage({ onSearchWords, onBack }) {
  const root = $('#view-actor-body');
  root.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-fav-actor]');
    if (heart) return onHeart(+heart.dataset.favActor);
    if (e.target.closest('[data-act="to-search"]')) return onBack();
    if (e.target.closest('[data-act="search-words"]')) {
      const a = getActor(+root.dataset.id);
      return a && onSearchWords(a);
    }
    const card = e.target.closest('.card');
    if (card && root._vids) return openDetail(root._vids[+card.dataset.i], { list: root._vids, index: +card.dataset.i });
  });
  $('#actor-back').onclick = onBack;
  on('favactors', () => syncHearts(root));
}

// ───────────── お気に入りの出演者（#favactors） ─────────────

export function renderFavActors() {
  const list = mountActorList($('#favactors-list'), { ids: favActorIds(), sort: 'name', emptyText: 'お気に入りの出演者はまだいません。出演者の ♡ を押すと追加されます' });
  return list;
}
