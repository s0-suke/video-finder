// 動画の詳細シート
//
// 差し込み口
//   - 再生:        player.js の mountPlayer(container, embedUrl)
//   - お気に入り:  favorites.js の favButton(video)
//   - 詳細情報:    details.js の mountDetails(container, video, { onTag, onStudio })
//
// 再生・お気に入りはサムネイルのすぐ下（同じ動画の情報の近くに置く）。
// 前後の動画への移動（‹ 前へ / 次へ ›、関連動画からは ‹ 戻る）は片手で届くよう下端に固定したバーに置く。
// シートの高さは一定にして、動画を切り替えてもボタンの位置が動かないようにする。

import { esc, fmtDate } from '../util.js';
import { state, on } from '../data.js';
import { loadContent } from '../source.js';
import { mountPlayer } from '../player.js';
import { favButton } from '../favorites.js';
import { mountDetails } from '../details.js';
import { recordView } from '../history.js';
import { releaseSpan, releaseLabel } from '../release.js';
import { feature } from '../features.js';
import { openSheet, closeSheet, miniPlayer, expandMini, closeMini } from './sheet.js';
import { setQuery, setStudio } from './list.js';
import { showActor } from '../actor.js';

const RELATED = 12;

// 詳細情報の取得で発売日が分かったら、開いている詳細の表示をその場で更新する
let shown = null; // { video, el }
on('release', (key) => {
  if (!shown || shown.video.key !== key) return;
  const rel = shown.el.querySelector('[data-role="release"]');
  if (rel) Object.assign(rel, { textContent: releaseLabel(shown.video).text, title: releaseLabel(shown.video).title });
});

// 前後の動画へ移るための並び（一覧から開いたときだけ）と、関連動画から開いたときに戻るための積み重ね
let nav = null; // { list, index }
let back = []; // [{ video, nav }]

function go(step) {
  if (!nav) return;
  const i = nav.index + step;
  if (i < 0 || i >= nav.list.length) return;
  openDetail(nav.list[i], { list: nav.list, index: i });
}

function goBack() {
  const prev = back.pop();
  if (prev) openDetail(prev.video, { ...(prev.nav || {}), keepBack: true });
}

// 同じスタジオの動画（新しい順。自分自身は除く）
function relatedHTML(video) {
  if (!feature('related') || !video.studioKey) return '';
  const list = [];
  for (const v of state.videos) {
    if (v.studioKey === video.studioKey && v.key !== video.key && v.title !== video.title) list.push(v);
    if (list.length >= RELATED) break;
  }
  if (!list.length) return '';
  return `
    <div class="section-title">${esc(video.studio)} の動画</div>
    <div class="related">
      ${list.map((v) => `
        <button class="rel" data-related="${esc(v.key)}">
          <div class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || '')}</div>`}</div>
          <div class="title">${esc(v.title)}</div>
        </button>`).join('')}
      <button class="rel more" data-studio="${esc(video.studioKey)}">すべて見る →</button>
    </div>`;
}

// opts.list / opts.index を渡すと、その並びで前後の動画へ移れる。
// opts.keepBack は「戻る」で開いたとき（戻り先の積み重ねを消さない）
// スタジオの表示: 親があれば「親 › 子」（どちらも押すとそのスタジオで絞り込む。親を押すと子の動画も出る）
function studioCrumb(video) {
  if (!video.studio) return '';
  const chain = [];
  const byKey = new Map(state.studios.map((x) => [x.key, x]));
  for (let k = byKey.get(video.studioKey) && byKey.get(video.studioKey).parent, n = 0; k && n < 4; n++) {
    const p = byKey.get(k);
    if (!p) break;
    chain.unshift(p);
    k = p.parent;
  }
  const link = (key, name) => `<button class="link" data-studio="${esc(key)}">${esc(name)}</button>`;
  return chain.map((p) => link(p.key, p.name) + '<span class="crumb">›</span>').join('') + link(video.studioKey, video.studio);
}

export function openDetail(video, opts = {}) {
  if (!video) return;
  // ミニプレイヤーで再生中の動画なら、それを大きく表示する（読み込み直さない）
  const m = miniPlayer();
  if (m && m.dataset.key === video.key) return expandMini();
  nav = opts.list && feature('swipeNav') ? { list: opts.list, index: opts.index } : null;
  if (!opts.keepBack && !opts.fromRelated) back = [];

  const el = document.createElement('div');
  el.className = 'detail';
  el.innerHTML = `
    <div class="hero" data-role="hero">${video.thumb
      ? `<img src="${esc(video.thumb)}" referrerpolicy="no-referrer" alt="">`
      : `<div class="ph">${esc(video.studio || video.title.slice(0, 16))}</div>`}</div>
    <div class="detail-actions">
      <button class="btn primary play-main" disabled>確認中…</button>
      <span data-role="fav"></span>
    </div>
    <h2>${esc(video.title)}</h2>
    <div class="kv">
      ${video.code ? `<span>${esc(video.code)}</span>` : ''}
      ${studioCrumb(video)}
      <span>掲載 ${esc(fmtDate(video.date))}</span>
      ${releaseSpan(video)}
    </div>
    <div data-role="details"></div>
    ${video.tags.length ? `<div class="tags">${video.tags.map((t) => `<button class="tag" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${relatedHTML(video)}
    <div class="section-title">掲載サイト（${video.sources.length}）</div>
    ${video.sources.map((s) => `
      <div class="source">
        <div class="head"><span class="name">${esc(s.siteName)}</span></div>
        <div class="btn-row">
          <span class="embeds" data-key="${esc(s.key)}"></span>
          ${s.link ? `<a class="btn" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">サイトで開く ↗</a>` : ''}
        </div>
      </div>`).join('')}
    ${back.length || opts.fromRelated || nav ? `
    <div class="detail-bar">
      ${back.length || opts.fromRelated
        ? '<button class="btn nav-btn wide" data-act="back" aria-label="前の動画に戻る">‹ 戻る</button>'
        : `<button class="btn nav-btn wide" data-step="-1" aria-label="前の動画" ${nav.index > 0 ? '' : 'disabled'}>‹ 前へ</button>`}
      <span class="detail-pos">${nav ? `${(nav.index + 1).toLocaleString()} / ${nav.list.length.toLocaleString()}` : ''}</span>
      ${nav ? `<button class="btn nav-btn wide" data-step="1" aria-label="次の動画" ${nav.index < nav.list.length - 1 ? '' : 'disabled'}>次へ ›</button>` : '<span class="nav-spacer"></span>'}
    </div>` : ''}
  `;
  const hero = el.querySelector('[data-role="hero"]');
  el.querySelector('[data-role="fav"]').appendChild(favButton(video));
  mountDetails(el.querySelector('[data-role="details"]'), video, {
    onTag: (t) => { closeSheet(); setQuery(t); },
    onStudio: (key) => { closeSheet(); setStudio(key); },
    onActor: (name, q) => { closeSheet(); showActor(name, q); },
  });

  const main = el.querySelector('.play-main');
  const play = (url) => {
    closeMini(); // 再生するのは 1 本だけ
    mountPlayer(hero, url);
    el.closest('.sheet').scrollTo({ top: 0, behavior: 'smooth' });
    recordView(video);
    main.textContent = '↻ 読み込み直す';
    main.dataset.embed = url; // 今見ているプレイヤーを読み込み直す
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-q]');
    if (t) { closeSheet(); return setQuery(t.dataset.q); }
    const st = e.target.closest('[data-studio]');
    if (st) { closeSheet(); return setStudio(st.dataset.studio); }
    const em = e.target.closest('[data-embed]');
    if (em) return play(em.dataset.embed);
    const rel = e.target.closest('[data-related]');
    if (rel) {
      // 関連動画へ移る。‹ で今の動画に戻れるよう積んでおく（開く先がなければ積まない）
      const next = state.byKey.get(rel.dataset.related);
      if (!next) return;
      back.push({ video, nav });
      return openDetail(next, { fromRelated: true });
    }
    if (e.target.closest('[data-act="back"]')) return goBack();
    const step = e.target.closest('[data-step]');
    if (step) go(+step.dataset.step);
  });

  // 左右スワイプで前後の動画へ（横スクロールする部品の上では使わない）
  let sx = null, sy = 0;
  el.addEventListener('touchstart', (e) => {
    sx = e.target.closest('.dt-carousel, .related, .tags, .hero iframe, .detail-bar, .dt-root [class*="gallery"]') ? null : e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null || !nav) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
    sx = null;
  });

  const sheetEl = openSheet(el, { tall: true });
  shown = { video, el };
  // ミニプレイヤーから大きく戻したとき、前後移動・戻る先をこの動画のものに戻す
  sheetEl.dataset.key = video.key;
  const myNav = nav, myBack = back;
  sheetEl.__restore = () => { nav = myNav; back = myBack; shown = { video, el }; };

  // 各掲載サイトの本文からプレイヤーを取り出す。最初に見つかったものを大きな再生ボタンに割り当てる
  let mainUrl = null;
  const jobs = video.sources.map((s) => {
    const slot = el.querySelector(`.embeds[data-key="${CSS.escape(s.key)}"]`);
    return loadContent(s)
      .then((p) => {
        slot.innerHTML = p.embeds.map((u, k) => `<button class="btn" data-embed="${esc(u)}">▶ ${p.embeds.length > 1 ? k + 1 : '再生'}</button>`).join('');
        if (!mainUrl && p.embeds.length) {
          mainUrl = p.embeds[0];
          main.disabled = false;
          main.textContent = '▶ 再生';
          main.dataset.embed = mainUrl;
        }
      })
      .catch(() => { slot.innerHTML = '<span class="note">プレイヤーを取得できません</span>'; });
  });
  // 再生できるプレイヤーがなければ、大きなボタンを「サイトで開く」にする
  Promise.allSettled(jobs).then(() => {
    if (mainUrl || !main.isConnected) return;
    const link = video.sources.map((s) => s.link).find(Boolean);
    if (!link) { main.textContent = '再生できません'; return; }
    const a = document.createElement('a');
    a.className = 'btn primary play-main';
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'サイトで開く ↗';
    main.replaceWith(a);
  });
}
