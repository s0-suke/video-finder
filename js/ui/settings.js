// 設定画面（収集対象サイト・収集・データ）
//
// 他のモジュールは registerSettingsSection() で設定画面に項目を足せる

import { $, esc } from '../util.js';
import * as db from '../db.js';
import { state, on, rebuild, emit, saveSite } from '../data.js';
import { crawl, collect, addSite, removeSite, wipeData } from '../crawler.js';

const sections = [];

// { id, title, render(el) }。render は設定画面を開くたびに呼ばれる
export function registerSettingsSection(section) {
  sections.push(section);
}

export const isSettingsOpen = () => location.hash === '#settings';

export async function renderSettings() {
  $('#sites').innerHTML = state.sites.map((s) => `
    <div class="site">
      <div class="row">
        <div class="info">
          <div class="host">${esc(s.name)}</div>
          <div class="status ${s.error ? 'err' : ''}">${esc(s.status || '未収集')} · ${(s.count || 0).toLocaleString()} 件${s.lastRun ? ' · ' + new Date(s.lastRun).toLocaleString('ja-JP') : ''}</div>
        </div>
        <button class="toggle ${s.enabled ? 'on' : ''}" data-toggle="${s.id}" aria-label="${esc(s.name)} を${s.enabled ? '無効にする' : '有効にする'}" aria-pressed="${s.enabled ? 'true' : 'false'}"></button>
      </div>
      <div class="btn-row">
        <button class="btn" data-collect="${s.id}" ${crawl.running ? 'disabled' : ''}>収集</button>
        <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">開く ↗</a>
        <button class="btn danger" data-del="${s.id}" style="margin-left:auto">削除</button>
      </div>
    </div>`).join('');
  $('#collect-status').textContent = crawl.running
    ? `収集中…（新規 ${crawl.added.toLocaleString()} 件 / 統合後 ${state.videos.length.toLocaleString()} 本）`
    : `待機中（統合後 ${state.videos.length.toLocaleString()} 本）`;
  $('#collect-all').disabled = $('#collect-full').disabled = crawl.running;
  $('#interval').value = String(await db.kvGet('intervalMin', 30));
  const last = await db.kvGet('lastCollect', 0);
  $('#last-run').textContent = last ? `前回の収集: ${new Date(last).toLocaleString('ja-JP')}` : 'まだ収集していません';
  if (navigator.storage && navigator.storage.estimate) {
    const { usage } = await navigator.storage.estimate();
    $('#storage').textContent = `使用容量: 約 ${(usage / 1024 / 1024).toFixed(1)} MB`;
  }
}

// 追加セクションは開いたときに 1 回だけ描く（入力中の内容が収集の進捗で消えないように）
function renderSections() {
  const root = $('#settings-extra');
  root.innerHTML = '';
  for (const s of sections) {
    root.insertAdjacentHTML('beforeend', `<div class="section-title">${esc(s.title)}</div>`);
    const el = document.createElement('div');
    el.className = 'site';
    el.dataset.section = s.id;
    root.appendChild(el);
    s.render(el);
  }
}

export function openSettings() {
  renderSettings();
  renderSections();
}

export function initSettings() {
  $('#sites').onclick = async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const s = state.sites.find((x) => x.id === +t.dataset.toggle);
      if (!s) return renderSettings(); // 描いたあとにサイトが消えていた
      s.enabled = !s.enabled;
      await saveSite(s);
      rebuild();
      emit('data');
      return renderSettings();
    }
    const c = e.target.closest('[data-collect]');
    if (c) return collect({ siteId: +c.dataset.collect });
    const d = e.target.closest('[data-del]');
    if (d && confirm('このサイトと収集済みデータを削除しますか？')) { await removeSite(+d.dataset.del); renderSettings(); }
  };
  $('#collect-all').onclick = () => collect();
  $('#collect-full').onclick = () => { if (confirm('全ページを取り直します。時間と通信量がかかりますがよいですか？')) collect({ full: true }); };
  $('#interval').onchange = () => db.kvSet('intervalMin', +$('#interval').value);
  $('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#add-form button');
    btn.disabled = true;
    try {
      const s = await addSite($('#add-url').value);
      $('#add-url').value = '';
      renderSettings();
      collect({ siteId: s.id });
    } catch (err) {
      alert('追加できませんでした: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  };
  $('#wipe').onclick = async () => {
    if (!confirm('収集したデータをすべて削除します（サイトの登録・お気に入りは残ります）。よいですか？')) return;
    await wipeData();
    renderSettings();
  };
  on('progress', () => { if (isSettingsOpen()) renderSettings(); });
  on('data', () => { if (isSettingsOpen()) renderSettings(); });
}
