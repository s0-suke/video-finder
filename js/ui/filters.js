// ホームの絞り込みシート（日付の基準・並び順・スタジオ・取得元サイト・サムネなしを隠す）と、スタジオ一覧

import { $, esc, toast } from '../util.js';
import { state } from '../data.js';
import { openSheet, closeSheet, afterClose } from './sheet.js';
import { studioRows } from '../studios.js';
import { isFavStudio, toggleFavStudio } from '../studio-favs.js';

/** f: ホームの絞り込み（home.js の filters）。onApply(変更後の値) を適用ボタンで呼ぶ */
export function openFilters(f, onApply) {
  const enabled = state.sites.filter((s) => s.enabled);
  openSheet(`
    <h2 style="margin-top:0">絞り込み</h2>
    <div class="field"><label>日付の基準</label>
      <div class="seg" id="f-dateby">
        <button data-v="post" class="${f.dateBy !== 'release' ? 'on' : ''}">掲載日</button>
        <button data-v="release" class="${f.dateBy === 'release' ? 'on' : ''}">発売日（目安）</button>
      </div>
    </div>
    <div class="field"><label>並び順</label>
      <div class="seg" id="f-sort">
        <button data-v="new" class="${f.sort === 'new' ? 'on' : ''}">新しい順</button>
        <button data-v="old" class="${f.sort === 'old' ? 'on' : ''}">古い順</button>
        <button data-v="random" class="${f.sort === 'random' ? 'on' : ''}">ランダム</button>
      </div>
    </div>
    <div class="field"><label>スタジオ</label>
      <select id="f-studio"><option value="">すべて</option>
        ${studioRows(state.studios).map(({ s, depth }) => `<option value="${esc(s.key)}" ${f.studio === s.key ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '└ ' : ''}${esc(s.name)}（${s.total.toLocaleString()}）</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>取得元サイト</label>
      <select id="f-site"><option value="">すべて</option>
        ${enabled.map((s) => `<option value="${s.id}" ${String(f.site) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field switch"><span>サムネイルのない動画を隠す<span class="note" style="display:block;font-size:11px">はじめはオン。オフにするとサムネのない動画も出ます</span></span>
      <button class="toggle ${f.hideNoThumb ? 'on' : ''}" id="f-nothumb" aria-label="サムネイルのない動画を隠す"></button>
    </div>
    <div class="btn-row">
      <button class="btn" id="f-reset">リセット</button>
      <button class="btn primary" id="f-apply" style="flex:1;justify-content:center">適用</button>
    </div>
  `);
  let { sort, dateBy, hideNoThumb } = f;
  $('#f-nothumb').onclick = (e) => { hideNoThumb = !hideNoThumb; e.target.classList.toggle('on', hideNoThumb); };
  const seg = (id, set) => { $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); for (const x of $(id).children) x.classList.toggle('on', x === b); }; };
  seg('#f-dateby', (v) => { dateBy = v; });
  seg('#f-sort', (v) => { sort = v; });
  $('#f-reset').onclick = () => { closeSheet(); onApply({ sort: 'new', dateBy: 'post', studio: '', site: '', hideNoThumb: true }); };
  $('#f-apply').onclick = () => { closeSheet(); onApply({ sort, dateBy, hideNoThumb, studio: $('#f-studio').value, site: $('#f-site').value }); };
}

// スタジオ一覧（名前で探し、タップでそのスタジオに絞る。★ でお気に入りのスタジオにする）
// 親（会社・メーカー）の下に子（レーベル）を並べる。親の本数は子を含めた合計で、親を選ぶと子の動画も出る。
// 探していないときは親だけを並べ、「▸」で子を開く。探しているときは、当てはまる行を親の名前つきで並べる
const expanded = new Set(); // 開いている親の key（シートを開き直しても覚えておく）

/** current: いま選んでいるスタジオの key。onPick(key) は選んだとき（「すべて」は ''） */
export function openStudioPicker({ current = '', onPick }) {
  const el = openSheet(`
    <h2 style="margin-top:0">スタジオ</h2>
    <input class="picker-q" type="search" placeholder="スタジオ名で探す" aria-label="スタジオ名で探す" autocomplete="off">
    <div class="picker-list"></div>
  `);
  const q = el.querySelector('.picker-q');
  const list = el.querySelector('.picker-list');
  const byKey = new Map(state.studios.map((s) => [s.key, s]));
  const row = (s, { depth = 0, via = '' } = {}) => {
    const kids = s.children.length;
    const open = expanded.has(s.key);
    const toggle = kids && !via
      ? `<button class="picker-toggle ${open ? 'open' : ''}" data-toggle="${esc(s.key)}" aria-label="${open ? '閉じる' : '子のスタジオを開く'}"><span>▸</span></button>`
      : '<span class="picker-toggle gap"></span>';
    const fav = isFavStudio(s.key);
    return `<div class="picker-item d${Math.min(depth, 2)}">${toggle}` +
      `<button class="picker-row ${current === s.key ? 'on' : ''}" data-key="${esc(s.key)}"><span>${via ? `<small class="picker-via">${esc(via)} ›</small> ` : ''}${esc(s.name)}${kids ? `<small class="picker-kids">${kids} 件のレーベル</small>` : ''}</span><span class="picker-n">${s.total.toLocaleString()}</span></button>` +
      `<button class="picker-star ${fav ? 'on' : ''}" data-fav="${esc(s.key)}" aria-pressed="${fav}" aria-label="${esc(s.name)}をお気に入り${fav ? 'から外す' : 'にする'}">${fav ? '★' : '☆'}</button></div>`;
  };
  const paint = () => {
    const w = q.value.trim().normalize('NFKC').toLowerCase();
    let html = current ? '<button class="picker-row" data-key="">すべてのスタジオ</button>' : '';
    if (w) {
      const rows = state.studios.filter((s) => s.name.normalize('NFKC').toLowerCase().includes(w)).slice(0, 300);
      html += rows.map((s) => row(s, { via: s.parent ? ((byKey.get(s.parent) || {}).name || '') : '' })).join('') + (rows.length ? '' : '<p class="note">見つかりません</p>');
    } else {
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
  list.onclick = (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) { const k = t.dataset.toggle; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); return paint(); }
    const star = e.target.closest('[data-fav]');
    if (star) {
      const s = byKey.get(star.dataset.fav);
      const added = toggleFavStudio(star.dataset.fav, s ? s.name : star.dataset.fav);
      toast(added ? `★ ${s ? s.name : ''} をお気に入りにしました` : `${s ? s.name : ''} をお気に入りから外しました`);
      star.classList.toggle('on', added);
      star.textContent = added ? '★' : '☆';
      star.setAttribute('aria-pressed', String(added));
      return;
    }
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const key = b.dataset.key;
    afterClose(() => onPick(key));
  };
}
