// 動画の詳細シート
//
// 差し込み口
//   - 再生:        player.js の mountPlayer(container, embedUrl)
//   - お気に入り:  favorites.js の favButton(video)
//   - 詳細情報:    details.js の mountDetails(container, video, { onTag, onStudio })

import { esc, fmtDate } from '../util.js';
import { state, on } from '../data.js';
import { loadContent } from '../source.js';
import { mountPlayer } from '../player.js';
import { favButton } from '../favorites.js';
import { mountDetails } from '../details.js';
import { recordView } from '../history.js';
import { feature } from '../features.js';
import { openSheet, closeSheet } from './sheet.js';
import { setQuery, setStudio } from './list.js';

const RELATED = 12;

// 詳細情報の取得で発売日が分かったら、開いている詳細の表示をその場で更新する
let shown = null; // { video, el }
on('release', (key) => {
  if (!shown || shown.video.key !== key) return;
  const rel = shown.el.querySelector('[data-role="release"]');
  if (rel) rel.textContent = `発売 ${fmtDate(shown.video.release)}`;
});

function go(step) {
  if (!nav) return;
  const i = nav.index + step;
  if (i < 0 || i >= nav.list.length) return;
  openDetail(nav.list[i], { list: nav.list, index: i });
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

// 左右スワイプで前後の動画へ移るための並び（一覧から開いたときだけ）
let nav = null; // { list, index }

// opts.list / opts.index を渡すと、その並びで前後の動画へスワイプで移れる
export function openDetail(video, opts = {}) {
  if (!video) return;
  nav = opts.list && feature('swipeNav') ? { list: opts.list, index: opts.index } : null;
  const el = document.createElement('div');
  el.className = 'detail';
  el.innerHTML = `
    <div class="hero" data-role="hero">${video.thumb ? `<img src="${esc(video.thumb)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
    <div class="detail-actions">
      <button class="btn primary play-main" disabled>プレイヤー確認中…</button>
      <span data-role="fav"></span>
    </div>
    <h2>${esc(video.title)}</h2>
    <div class="kv">
      ${video.code ? `<span>${esc(video.code)}</span>` : ''}
      ${video.studio ? `<button class="link" data-studio="${esc(video.studioKey)}">${esc(video.studio)}</button>` : ''}
      <span>掲載 ${esc(fmtDate(video.date))}</span>
      <span data-role="release">${video.release ? `発売 ${esc(fmtDate(video.release))}` : '発売日不明'}</span>
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
          <a class="btn" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">サイトで開く ↗</a>
        </div>
      </div>`).join('')}
  `;
  const hero = el.querySelector('[data-role="hero"]');
  el.querySelector('[data-role="fav"]').appendChild(favButton(video));
  mountDetails(el.querySelector('[data-role="details"]'), video, {
    onTag: (t) => { closeSheet(); setQuery(t); },
    onStudio: (key) => { closeSheet(); setStudio(key); },
  });

  const play = (url) => {
    mountPlayer(hero, url);
    el.closest('.sheet').scrollTo({ top: 0, behavior: 'smooth' });
    recordView(video);
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-q]');
    if (t) { closeSheet(); return setQuery(t.dataset.q); }
    const st = e.target.closest('[data-studio]');
    if (st) { closeSheet(); return setStudio(st.dataset.studio); }
    const em = e.target.closest('[data-embed]');
    if (em) return play(em.dataset.embed);
    const rel = e.target.closest('[data-related]');
    if (rel) openDetail(state.byKey.get(rel.dataset.related));
    const step = e.target.closest('[data-step]');
    if (step) go(+step.dataset.step);
  });

  // 前後の動画への移動（スワイプか、見出し横の ‹ › ボタン）
  if (nav) {
    const pos = document.createElement('div');
    pos.className = 'detail-nav';
    pos.innerHTML = `<button class="link" data-step="-1" ${nav.index > 0 ? '' : 'disabled'} aria-label="前の動画">‹ 前へ</button>
      <span>${(nav.index + 1).toLocaleString()} / ${nav.list.length.toLocaleString()}</span>
      <button class="link" data-step="1" ${nav.index < nav.list.length - 1 ? '' : 'disabled'} aria-label="次の動画">次へ ›</button>`;
    el.prepend(pos);
  }
  let sx = null, sy = 0;
  el.addEventListener('touchstart', (e) => {
    // 横スクロールする部品（カルーセル・関連動画・タグ・プレイヤー）の上では使わない
    sx = e.target.closest('.dt-carousel, .related, .tags, .hero iframe, .dt-root [class*="gallery"]') ? null : e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null || !nav) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
    sx = null;
  });

  openSheet(el);

  shown = { video, el };

  // 各掲載サイトの本文からプレイヤーを取り出す。最初に見つかったものを大きな再生ボタンに割り当てる
  const main = el.querySelector('.play-main');
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
  Promise.allSettled(jobs).then(() => {
    if (!mainUrl) { main.textContent = '再生できるプレイヤーがありません'; }
  });
}
