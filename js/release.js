// 発売日の目安（元動画の公開日）
//
// otokoki.net は新作の配信に合わせて記事を出すので、その掲載日を「発売日の目安」として使う。
// 記事のタイトルと日付だけを全件（約 4.4 万件、タイトルのみなので数 MB）取り、
// 品番 → 日付 / 正規化したタイトル → 日付 の対応表を作る。
// otokoki に載っていない動画は、各掲載サイトのうち最も早い掲載日で代用する（data.js の rebuild）。
//
// 収集は crawler.js と同じく、新着側から差分 → 初回の全件取得（途中で止めても続きから）の順。

import * as db from './db.js';
import { state, rebuild, emit } from './data.js';
import { wpGet } from './wp.js';
import { sleep, decodeEntities } from './util.js';
import { releaseCode, releaseTitleKey } from './matching.js';
import { registerSettingsSection } from './ui/settings.js';

const OTOKOKI = 'https://otokoki.net/';
const PER_PAGE = 100;
const PAGE_DELAY_MS = 400;
const DEV = new URLSearchParams(location.search).has('dev');
const INTERVAL_MS = 30 * 60 * 1000; // 全件取得が済んだあとは 30 分に 1 回だけ差分を見る

export const release = { running: false, status: null, page: 0, total: 0 };
const knownIds = new Set();

export async function initRelease() {
  for (const r of await db.getAll('release')) { knownIds.add(r.id); index(r); }
  if (state.release.byCode.size || state.release.byTitle.size) rebuild();
  registerSettingsSection({ id: 'release', title: '発売日の目安', render: renderSection });
}

function renderSection(el) {
  const paint = async () => {
    if (!el.isConnected) return;
    const enabled = await db.kvGet('releaseEnabled', true);
    el.innerHTML = `
      <div class="switch"><span>otokoki の掲載日を発売日の目安に使う</span><button class="toggle ${enabled ? 'on' : ''}" data-act="toggle" aria-label="切り替え"></button></div>
      <div class="status">${release.running ? release.status : release.status || (state.release.byTitle.size ? `${state.release.byCode.size.toLocaleString()} 品番 / ${state.release.byTitle.size.toLocaleString()} タイトル` : 'まだ取得していません')}</div>
      <div class="btn-row"><button class="btn" data-act="refetch" ${release.running ? 'disabled' : ''}>取り直す</button></div>
      <p class="note" style="margin-bottom:0">絞り込みの「日付の基準」で「発売日」を選ぶと、この日付で並びます。otokoki は新作の配信に合わせて記事を出すため、その掲載日を発売日の目安にしています。載っていない動画は、各サイトで最も早い掲載日で代用します。初回は記事のタイトルと日付だけを全件（数 MB）取得します。</p>`;
    el.querySelector('[data-act="toggle"]').onclick = async () => {
      await db.kvSet('releaseEnabled', !enabled);
      if (!enabled) collectRelease({ force: true });
      paint();
    };
    el.querySelector('[data-act="refetch"]').onclick = async () => {
      if (!confirm('発売日の目安の対応表を取り直します。よいですか？')) return;
      await wipeRelease();
      collectRelease({ force: true });
      paint();
    };
  };
  paint();
  const timer = setInterval(() => (el.isConnected ? paint() : clearInterval(timer)), 3000);
}

function index(r) {
  if (r.code && !state.release.byCode.has(r.code)) state.release.byCode.set(r.code, r.date);
  if (r.tkey && !state.release.byTitle.has(r.tkey)) state.release.byTitle.set(r.tkey, r.date);
  // 同じ作品の記事が複数あるときは、いちばん早い日付を残す
  if (r.code && r.date < state.release.byCode.get(r.code)) state.release.byCode.set(r.code, r.date);
  if (r.tkey && r.date < state.release.byTitle.get(r.tkey)) state.release.byTitle.set(r.tkey, r.date);
}

function toRow(p) {
  const title = decodeEntities(p.title && p.title.rendered);
  return { id: p.id, date: p.date, code: releaseCode(title), tkey: releaseTitleKey(title) };
}

async function crawlPages(start, { stopWhenKnown, track, maxPage = Infinity }) {
  let page = start, total = start;
  while (page <= Math.min(total, maxPage)) {
    Object.assign(release, { page, total, status: `取得中 ${page}/${total} ページ` });
    emit('progress');
    const { data, totalPages } = await wpGet(OTOKOKI, 'posts', { per_page: PER_PAGE, page, _fields: 'id,date,title' });
    total = totalPages;
    if (!data.length) break;
    const rows = data.map(toRow);
    let known = 0;
    for (const r of rows) {
      if (knownIds.has(r.id)) known++; else knownIds.add(r.id);
      index(r);
    }
    await db.putAll('release', rows);
    if (track) await db.kvSet('releaseBackfillPage', page);
    if (page % 40 === 0) { rebuild(); emit('data'); } // 全件取得中も、ときどき並び順に反映する
    if (stopWhenKnown && known === rows.length) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

export async function collectRelease({ force = false } = {}) {
  if (release.running || !navigator.onLine || !(await db.kvGet('releaseEnabled', true))) return;
  const done = await db.kvGet('releaseBackfillDone', false);
  if (!force && done && Date.now() - (await db.kvGet('releaseLastRun', 0)) < INTERVAL_MS) return;
  release.running = true;
  try {
    if (DEV) {
      await crawlPages(1, { stopWhenKnown: true, track: false, maxPage: 1 });
    } else {
      await crawlPages(1, { stopWhenKnown: true, track: !done });
      if (!done) {
        await crawlPages(await db.kvGet('releaseBackfillPage', 1), { stopWhenKnown: false, track: true });
        await db.kvSet('releaseBackfillDone', true);
      }
    }
    release.status = `OK（${state.release.byCode.size.toLocaleString()} 品番 / ${state.release.byTitle.size.toLocaleString()} タイトル）`;
    await db.kvSet('releaseLastRun', Date.now());
  } catch (e) {
    release.status = 'エラー: ' + e.message;
  } finally {
    release.running = false;
    rebuild();
    emit('data');
    emit('progress');
  }
}

export async function wipeRelease() {
  await db.clear('release');
  knownIds.clear();
  await db.kvSet('releaseBackfillDone', false);
  await db.kvSet('releaseBackfillPage', 1);
  state.release.byCode.clear();
  state.release.byTitle.clear();
  release.status = null;
  rebuild();
  emit('data');
}
