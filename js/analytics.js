// 利用データの記録と書き出し（端末の中だけ。サーバーには送らない）
//
// 何をどう操作したか（タブ・ボタンの種類、動画を開いた経路、再生までのタップ数・スクロール量・時間）を残し、
// 設定の「利用データ」から JSON で書き出せる。書き出したファイルを Claude に渡すと、導線の課題を分析できる。
// 検索語・タイトル・出演者名は残さない（usage-core.js の先頭に記録の定義がある）。
//
// 公開する関数
//   initAnalytics()          起動時に 1 回
//   track(e, data)           イベントを足す（detail.js / favorites.js / ui/search.js などから）
//   trackView(page)          画面を開いた（main.js の route / ui/home.js のパネル切り替え）
//   usageContext()           { taps, scroll, ms }（起動からの累計。open / play に付ける）
//   currentSurface()         いま見ている画面の名前（'home:new' など）

import * as db from './db.js';
import { toast } from './util.js';
import { registerSettingsSection } from './ui/settings.js';
import { VERSION } from './version.js';
import { buildExport } from './usage-core.js';

const KEY = 'usageEvents';
const ON_KEY = 'vfUsageOn';
const MAX = 4000;
const DAY = 24 * 60 * 60 * 1000;

let events = [];
let loaded = false;
let t0 = Date.now();
let taps = 0;
let scrollSum = 0;
let lastY = 0;
let surface = '';
let surfaceMaxY = 0;
let timer = 0;

export const isOn = () => { try { return localStorage.getItem(ON_KEY) !== '0'; } catch { return true; } };
export const currentSurface = () => surface;
export const usageContext = () => ({ taps, scroll: Math.round(scrollSum), ms: Date.now() - t0 });

function save() {
  clearTimeout(timer);
  timer = 0;
  if (!loaded) return;
  db.kvSet(KEY, events.slice(-MAX)).catch(() => {});
}
const saveSoon = () => { if (!timer) timer = setTimeout(save, 1500); };

export function track(e, data = {}) {
  if (!isOn()) return;
  events.push({ t: Date.now(), e, ...data });
  if (events.length > MAX + 200) events = events.slice(-MAX);
  saveSoon();
}

function leaveSurface() {
  if (!surface) return;
  const h = window.innerHeight || 800;
  track('leave', { page: surface, maxY: Math.round(surfaceMaxY), screens: Math.round((surfaceMaxY / h) * 10) / 10 });
}

export function trackView(page) {
  if (page === surface) return;
  leaveSurface();
  surface = page;
  surfaceMaxY = 0;
  lastY = window.scrollY || 0;
  track('view', { page });
}

// タップの種類（文字は残さない）
function kindOf(el) {
  const tab = el.closest('[data-tab]');
  if (tab) return `tab:${tab.dataset.tab}`;
  if (el.closest('#home-tabs button')) return `panel:${el.closest('button').dataset.p}`;
  if (el.closest('.fav-btn, [data-fav-actor], [data-fav-studio]')) return 'fav';
  if (el.closest('.card')) return 'card';
  if (el.closest('.rel')) return 'related';
  if (el.closest('.av-card, [data-actor]')) return 'actor';
  if (el.closest('.tag, [data-q]')) return 'tag';
  const act = el.closest('[data-act]');
  if (act) return `act:${String(act.dataset.act).split(':')[0]}`;
  if (el.closest('[data-studio]')) return 'studio';
  if (el.closest('[data-seg]')) return `seg:${el.closest('[data-seg]').dataset.seg}`;
  if (el.closest('.chip')) return 'chip';
  if (el.closest('[data-step]')) return 'step';
  if (el.closest('[data-embed], .play-main')) return 'play';
  if (el.closest('button, a, [role="button"], [role="tab"]')) return 'btn';
  return '';
}

export async function initAnalytics() {
  try {
    const saved = await db.kvGet(KEY, []);
    const keep = Date.now() - 90 * DAY;
    events = (Array.isArray(saved) ? saved : []).filter((x) => x && x.t > keep);
  } catch { events = []; }
  loaded = true;
  t0 = Date.now();
  track('launch', { v: VERSION });

  document.addEventListener('click', (ev) => {
    if (!(ev.target instanceof Element)) return;
    const k = kindOf(ev.target);
    if (!k) return;
    taps++;
    track('tap', { k, at: surface });
  }, true);

  window.addEventListener('scroll', () => {
    const y = window.scrollY || 0;
    scrollSum += Math.abs(y - lastY);
    lastY = y;
    if (y > surfaceMaxY) surfaceMaxY = y;
  }, { passive: true });

  // 画面を離れた・アプリを閉じたときに保存する（入れ替えで戻ってきたら、新しい起動として数える）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { leaveSurface(); surfaceMaxY = 0; save(); }
    else { t0 = Date.now(); taps = 0; scrollSum = 0; track('launch', { v: VERSION, resume: true }); if (surface) track('view', { page: surface }); }
  });

  registerSettingsSection({ id: 'usage', title: '利用データ', render: renderSection });
}

// ───────────── 設定 ─────────────

const exportObj = () => buildExport(events, {
  app: 'video-finder',
  appVersion: VERSION,
  device: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1, standalone: !!(window.navigator.standalone), ua: navigator.userAgent.slice(0, 120) },
});

async function share() {
  const json = JSON.stringify(exportObj(), null, 2);
  const name = `video-finder-usage-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '利用データ' }); return toast('書き出しました'); } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('書き出しました');
}

async function copy() {
  const json = JSON.stringify(exportObj(), null, 2);
  try { await navigator.clipboard.writeText(json); toast('コピーしました。Claude に貼り付けてください'); }
  catch { toast('コピーできませんでした。「書き出す」を使ってください'); }
}

function renderSection(el) {
  const nSessions = new Set(events.filter((x) => x.e === 'launch').map((x) => Math.floor(x.t / 60000))).size;
  el.innerHTML = `
    <p class="note">操作の回数・経路（どこから動画を開いたか、再生までのタップ数とスクロール量）を、この端末の中だけに記録します。検索語・タイトル・出演者名は記録しません。書き出したファイルを Claude に渡すと、使いにくいところを分析できます。</p>
    <div class="row" style="margin:8px 0">
      <div class="info"><div class="host">記録する</div><div class="status">${events.length.toLocaleString()} 件・起動 ${nSessions.toLocaleString()} 回ぶん（90 日まで）</div></div>
      <button class="toggle ${isOn() ? 'on' : ''}" id="usage-on" aria-label="利用データを記録する" aria-pressed="${isOn()}"></button>
    </div>
    <div class="btn-row">
      <button class="btn" id="usage-share" type="button">書き出す</button>
      <button class="btn" id="usage-copy" type="button">コピー</button>
      <button class="btn danger" id="usage-clear" type="button">消す</button>
    </div>`;
  el.querySelector('#usage-on').onclick = () => {
    try { localStorage.setItem(ON_KEY, isOn() ? '0' : '1'); } catch { /* 無視 */ }
    renderSection(el);
  };
  el.querySelector('#usage-share').onclick = share;
  el.querySelector('#usage-copy').onclick = copy;
  el.querySelector('#usage-clear').onclick = async () => {
    if (!confirm('利用データをすべて消しますか？')) return;
    events = [];
    await db.kvSet(KEY, []).catch(() => {});
    renderSection(el);
  };
}
