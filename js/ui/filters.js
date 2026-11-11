// 絞り込みシート（並び順・スタジオ・取得元サイト）

import { $, esc } from '../util.js';
import { state } from '../data.js';
import { openSheet, closeSheet } from './sheet.js';
import { filters, saveFilters, render, renderChips, reshuffle } from './list.js';
import { studioRows } from '../studios.js';

export function openFilters() {
  const enabled = state.sites.filter((s) => s.enabled);
  openSheet(`
    <h2 style="margin-top:0">絞り込み</h2>
    <div class="field"><label>日付の基準</label>
      <div class="seg" id="f-dateby">
        <button data-v="post" class="${filters.dateBy !== 'release' ? 'on' : ''}">掲載日</button>
        <button data-v="release" class="${filters.dateBy === 'release' ? 'on' : ''}">発売日（目安）</button>
      </div>
      <p class="note" style="margin:6px 0 0">掲載日は各サイトに載った日、発売日は元の動画が出た日の目安です（設定の「発売日の目安」を参照）。</p>
    </div>
    <div class="field"><label>並び順</label>
      <div class="seg" id="f-sort">
        <button data-v="new" class="${filters.sort === 'new' ? 'on' : ''}">新しい順</button>
        <button data-v="old" class="${filters.sort === 'old' ? 'on' : ''}">古い順</button>
        <button data-v="random" class="${filters.sort === 'random' ? 'on' : ''}">ランダム</button>
      </div>
    </div>
    <div class="field"><label>スタジオ</label>
      <select id="f-studio"><option value="">すべて</option>
        ${studioRows(state.studios).map(({ s, depth }) => `<option value="${esc(s.key)}" ${filters.studio === s.key ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '└ ' : ''}${esc(s.name)}（${s.total.toLocaleString()}）</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>取得元サイト</label>
      <select id="f-site"><option value="">すべて</option>
        ${enabled.map((s) => `<option value="${s.id}" ${String(filters.site) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field switch"><span>サムネイルのない動画を隠す<span class="note" style="display:block;font-size:11px">掲載元に画像がない動画（再生もできないことが多い）</span></span>
      <button class="toggle ${filters.hideNoThumb ? 'on' : ''}" id="f-nothumb" aria-label="切り替え"></button>
    </div>
    <div class="btn-row">
      <button class="btn" id="f-reset">リセット</button>
      <button class="btn primary" id="f-apply" style="flex:1;justify-content:center">適用</button>
    </div>
  `);
  let sort = filters.sort;
  let dateBy = filters.dateBy;
  let hideNoThumb = filters.hideNoThumb;
  $('#f-nothumb').onclick = (e) => { hideNoThumb = !hideNoThumb; e.target.classList.toggle('on', hideNoThumb); };
  $('#f-dateby').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    dateBy = b.dataset.v;
    for (const x of $('#f-dateby').children) x.classList.toggle('on', x === b);
  };
  $('#f-sort').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sort = b.dataset.v;
    for (const x of $('#f-sort').children) x.classList.toggle('on', x === b);
  };
  const done = () => { saveFilters(); renderChips(); closeSheet(); render(); };
  $('#f-reset').onclick = () => { Object.assign(filters, { sort: 'new', dateBy: 'post', studio: '', site: '', hideNoThumb: false }); done(); };
  $('#f-apply').onclick = () => {
    Object.assign(filters, { sort, dateBy, hideNoThumb, studio: $('#f-studio').value, site: $('#f-site').value });
    if (sort === 'random') reshuffle();
    done();
  };
}

// スタジオ一覧（名前で絞り込み、本数の多い順。タップでそのスタジオに絞る）
// 親（会社・メーカー）の下に子（レーベル）を並べる。親の本数は子を含めた合計で、親を選ぶと子の動画も出る。
// 探していないときは親だけを並べ、「▸」で子を開く。探しているときは、当てはまる行を親の名前つきで並べる
const expanded = new Set(); // 開いている親の key（シートを開き直しても覚えておく）

export function openStudioPicker() {
  const el = openSheet(`
    <h2 style="margin-top:0">スタジオ</h2>
    <input class="picker-q" type="search" placeholder="スタジオ名で探す" autocomplete="off">
    <div class="picker-list"></div>
  `);
  const q = el.querySelector('.picker-q');
  const list = el.querySelector('.picker-list');
  const row = (s, { depth = 0, via = '' } = {}) => {
    const kids = s.children.length;
    const open = expanded.has(s.key);
    const toggle = kids && !via
      ? `<button class="picker-toggle ${open ? 'open' : ''}" data-toggle="${esc(s.key)}" aria-label="${open ? '閉じる' : '子のスタジオを開く'}"><span>▸</span></button>`
      : '<span class="picker-toggle gap"></span>';
    const prefix = via ? `<small class="picker-via">${esc(via)} ›</small> ` : '';
    const sub = kids ? `<small class="picker-kids">${kids} 件のレーベル</small>` : '';
    return `<div class="picker-item d${Math.min(depth, 2)}">${toggle}` +
      `<button class="picker-row ${filters.studio === s.key ? 'on' : ''}" data-key="${esc(s.key)}"><span>${prefix}${esc(s.name)}${sub}</span><span class="picker-n">${s.total.toLocaleString()}</span></button></div>`;
  };
  const paint = () => {
    const w = q.value.trim().normalize('NFKC').toLowerCase();
    const byKey = new Map(state.studios.map((s) => [s.key, s]));
    let html = filters.studio ? '<button class="picker-row" data-key="">すべてのスタジオ</button>' : '';
    if (w) {
      const rows = state.studios.filter((s) => s.name.normalize('NFKC').toLowerCase().includes(w)).slice(0, 300);
      html += rows.map((s) => row(s, { via: s.parent ? ((byKey.get(s.parent) || {}).name || '') : '' })).join('') +
        (rows.length ? '' : '<p class="note">見つかりません</p>');
    } else {
      // 親から順に。開いている親の子（その子も開いていれば孫）まで出す
      const walk = (s, depth) => {
        html += row(s, { depth });
        if (!expanded.has(s.key)) return;
        for (const ck of s.children) { const c = byKey.get(ck); if (c) walk(c, depth + 1); }
      };
      for (const s of state.studios) if (!s.parent) walk(s, 0);
    }
    list.innerHTML = html;
  };
  paint();
  q.addEventListener('input', paint);
  // マウス・キーボードの端末では、開いたらすぐ入力できるようにする。
  // タッチ端末では、キーボードが一覧の半分を覆って、親子の一覧が見づらくなるので、検索欄をタップしたときに出す
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  if (!touch) q.focus({ preventScroll: true });
  list.onclick = (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const k = t.dataset.toggle;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      return paint();
    }
    const b = e.target.closest('[data-key]');
    if (!b) return;
    filters.studio = b.dataset.key;
    saveFilters(); renderChips(); closeSheet(); render();
  };
}
