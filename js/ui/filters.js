// 絞り込みシート（並び順・スタジオ・取得元サイト）

import { $, esc } from '../util.js';
import { state } from '../data.js';
import { openSheet, closeSheet } from './sheet.js';
import { filters, saveFilters, render, renderChips } from './list.js';

export function openFilters() {
  const enabled = state.sites.filter((s) => s.enabled);
  openSheet(`
    <h2 style="margin-top:0">絞り込み</h2>
    <div class="field"><label>並び順</label>
      <div class="seg" id="f-sort">
        <button data-v="new" class="${filters.sort === 'new' ? 'on' : ''}">新しい順</button>
        <button data-v="old" class="${filters.sort === 'old' ? 'on' : ''}">古い順</button>
      </div>
    </div>
    <div class="field"><label>スタジオ</label>
      <select id="f-studio"><option value="">すべて</option>
        ${state.studios.map((s) => `<option value="${esc(s.key)}" ${filters.studio === s.key ? 'selected' : ''}>${esc(s.name)}（${s.count.toLocaleString()}）</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>取得元サイト</label>
      <select id="f-site"><option value="">すべて</option>
        ${enabled.map((s) => `<option value="${s.id}" ${String(filters.site) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row">
      <button class="btn" id="f-reset">リセット</button>
      <button class="btn primary" id="f-apply" style="flex:1;justify-content:center">適用</button>
    </div>
  `);
  let sort = filters.sort;
  $('#f-sort').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sort = b.dataset.v;
    for (const x of $('#f-sort').children) x.classList.toggle('on', x === b);
  };
  const done = () => { saveFilters(); renderChips(); closeSheet(); render(); };
  $('#f-reset').onclick = () => { Object.assign(filters, { sort: 'new', studio: '', site: '' }); done(); };
  $('#f-apply').onclick = () => {
    Object.assign(filters, { sort, studio: $('#f-studio').value, site: $('#f-site').value });
    if (filters.studio) filters.fav = '';
    done();
  };
}
