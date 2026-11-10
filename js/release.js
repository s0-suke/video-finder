// 元動画の発売日（配信開始日）
//
// 情報源（優先順。動画ごとに video.releaseSrc に出どころを持つ）
//   1. 公式（'official'）… CK DOWNLOAD（COAT グループの公式配信サイト。CORS 可）の検索結果の配信日。
//      COAT グループの作品（スタジオ・タグが CK DOWNLOAD / COAT / COAT WEST）だけ、品番で検索する。
//      1 回の検索で約 200KB あるため全件は取らず、詳細を開いたとき（releaseSpan）と、
//      収集のついでに新しい順で少しずつ（1 日 OFFICIAL_PER_DAY 件まで）調べる。
//      再販・再掲載で配信日が新しくなっている作品があるので、掲載元の最初の投稿日より遅い日付は使わない（data.js）。
//   2. otokoki の掲載日（'otokoki'。目安）… otokoki.net は新作の配信に合わせて記事を出す（記事に発売日は書いていない）。
//      記事のタイトルと日付だけを全件（約 4.4 万件、タイトルのみなので数 MB）取り、
//      品番 → 日付 / 正規化したタイトル → 日付 の対応表を作る。
//      詳細を開いて記事が見つかれば noteRelease で記録する。
//   3. 推定（'estimate'）… 上の 1・2 で分からない動画は、同じレーベルの前後の品番の発売日から推定する
//      （release-estimate.js。data.js の rebuild で付ける。video.releaseEst に根拠の前後の品番）。
// どれでも分からない動画は発売日不明（掲載日では代用しない）。
//
// otokoki の収集は crawler.js と同じく、新着側から差分 → 初回の全件取得（途中で止めても続きから）の順。

import * as db from './db.js';
import { state, rebuild, emit, applyRelease } from './data.js';
import { wpGet } from './wp.js';
import { sleep, decodeEntities, esc, fmtDate } from './util.js';
import { releaseCode, releaseTitleKey, normalizeCode, ckCodes, parseCkResult } from './matching.js';
import { registerSettingsSection } from './ui/settings.js';
import { ESTIMATE } from './release-estimate.js';

const OTOKOKI = 'https://otokoki.net/';
const PER_PAGE = 100;
const PAGE_DELAY_MS = 400;
const DEV = new URLSearchParams(location.search).has('dev');
const INTERVAL_MS = 30 * 60 * 1000; // 全件取得が済んだあとは 30 分に 1 回だけ差分を見る

const CK = 'https://www.ck-download.com/';
const OFFICIAL_PER_DAY = DEV ? 3 : 30; // 収集のついでに調べる本数（1 日あたり。1 本で約 200KB）
const OFFICIAL_DELAY_MS = 1500;
const OFFICIAL_MISS_TTL = 14 * 24 * 60 * 60 * 1000; // 見つからなかった作品は 14 日は調べ直さない（あとから配信されることがある）

export const release = { running: false, status: null, page: 0, total: 0 };
const knownIds = new Set();
const checked = new Map(); // video.key -> 公式の配信日を調べた結果の行（'ck:' の行）

export async function initRelease() {
  for (const r of await db.getAll('release')) {
    knownIds.add(r.id);
    if (r.src === 'official') indexOfficial(r); else index(r);
  }
  if (state.release.byCode.size || state.release.byTitle.size || state.release.official.size) rebuild();
  registerSettingsSection({ id: 'release', title: '発売日', render: renderSection });
}

// 詳細シートの「発売 …」の文言（出どころ付き）
export function releaseLabel(video) {
  if (!video.release) return { text: '発売日不明', title: '公式サイト・otokoki のどちらでも照合できませんでした' };
  const d = fmtDate(video.release);
  if (video.releaseSrc === 'estimate') {
    const e = video.releaseEst;
    return {
      text: `発売 ${d} ごろ（推定）`,
      title: e ? `${e.from.code}（${fmtDate(e.from.date)}）と ${e.to.code}（${fmtDate(e.to.date)}）から推定` : '同じレーベルの前後の品番の発売日から推定',
    };
  }
  return video.releaseSrc === 'official'
    ? { text: `発売 ${d}（CK 公式）`, title: 'CK DOWNLOAD（COAT グループの公式配信サイト）の配信日' }
    : { text: `発売 ${d} ごろ（otokoki）`, title: 'otokoki の紹介記事の掲載日（発売日の目安。実際の発売日とは数日ずれることがあります）' };
}

// 詳細シートの発売日の span。表示と同時に、COAT グループの作品なら公式の配信日を調べる（調べ済みなら通信しない）。
// 分かったら 'release' イベントで知らせる（detail.js が表示を差し替える）
export function releaseSpan(video) {
  if (video.releaseSrc !== 'official') lookupOfficial(video);
  const { text, title } = releaseLabel(video);
  return `<span data-role="release" title="${esc(title)}">${esc(text)}</span>`;
}

function indexOfficial(r) {
  checked.set(r.key, r);
  if (!r.date) return;
  const m = state.release.official;
  m.set('key:' + r.key, r.date);
  const ck = r.code && 'code:' + r.code;
  if (ck && (!m.has(ck) || r.date < m.get(ck))) m.set(ck, r.date);
}

const ckQuery = (video) => ckCodes({
  code: video.code,
  studio: video.studio,
  tags: video.sources.flatMap((s) => [s.studio, ...(s.tags || [])]),
  titles: video.sources.map((s) => s.title),
});

// 公式の配信日を調べる必要があるか（COAT グループの作品で、まだ調べていない／見つからず期限切れ）
function needsOfficial(video) {
  if (video.releaseSrc === 'official') return false;
  const prev = checked.get(video.key);
  if (prev && (prev.date || Date.now() - prev.checkedAt < OFFICIAL_MISS_TTL)) return false;
  return ckQuery(video).length > 0;
}

const inflight = new Map(); // video.key -> 調べている途中の Promise

// CK DOWNLOAD を品番で検索し、1 件だけ見つかったらその配信日を記録する。分かったら true
export function lookupOfficial(video) {
  if (!needsOfficial(video) || !navigator.onLine) return Promise.resolve(false);
  if (!inflight.has(video.key)) {
    inflight.set(video.key, fetchOfficial(video).catch(() => false).finally(() => inflight.delete(video.key)));
  }
  return inflight.get(video.key);
}

async function fetchOfficial(video) {
  if (!(await db.kvGet('releaseEnabled', true))) return false;
  let found = null, query = null;
  for (const code of ckQuery(video)) {
    const res = await fetch(CK + 'product/result?kw=' + encodeURIComponent(code), { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status); // 通信エラーは記録しない（次の機会に調べ直す）
    const { total, items } = parseCkResult(await res.text());
    // 部分一致の検索なので、ちょうど 1 件のときだけ使う
    // （スマホ版は件数の表示がないことがあるので、件数が取れたときだけ件数でも確かめる）
    if (items.length === 1 && (total === null || total === 1)) { found = items[0]; query = code; break; }
  }
  const row = {
    id: 'ck:' + video.key, src: 'official', key: video.key,
    code: video.code ? normalizeCode(video.code) : null, query,
    date: found ? found.date : null, url: found ? CK + 'product/detail/' + found.id : null,
    checkedAt: Date.now(),
  };
  indexOfficial(row);
  try { await db.put('release', row); } catch {}
  if (!row.date) return false;
  const before = video.releaseSrc;
  applyRelease(video);
  if (video.releaseSrc === 'official' && before !== 'official') emit('release', video.key);
  return video.releaseSrc === 'official';
}

// 収集のついでに、新しい動画から順に公式の配信日を調べる（1 日 OFFICIAL_PER_DAY 本まで）
async function collectOfficial() {
  const today = new Date().toISOString().slice(0, 10);
  let quota = await db.kvGet('releaseOfficialQuota', null);
  if (!quota || quota.day !== today) quota = { day: today, count: 0 };
  let changed = 0;
  for (const v of state.videos) {
    if (quota.count >= OFFICIAL_PER_DAY) break;
    if (!navigator.onLine || !needsOfficial(v)) continue;
    release.status = `公式の配信日を確認中（今日 ${quota.count + 1}/${OFFICIAL_PER_DAY} 本目）`;
    emit('progress');
    if (await lookupOfficial(v)) changed++;
    quota.count++;
    await db.kvSet('releaseOfficialQuota', quota);
    await sleep(OFFICIAL_DELAY_MS);
  }
  return changed;
}

function renderSection(el) {
  const paint = async () => {
    if (!el.isConnected) return;
    const enabled = await db.kvGet('releaseEnabled', true);
    el.innerHTML = `
      <div class="switch"><span>発売日を取得する</span><button class="toggle ${enabled ? 'on' : ''}" data-act="toggle" aria-label="切り替え"></button></div>
      <div class="status">${release.running ? release.status : release.status || (state.release.byTitle.size ? `${state.release.byTitle.size.toLocaleString()} 件の対応表` : 'まだ取得していません')}</div>
      <div class="btn-row"><button class="btn" data-act="refetch" ${release.running ? 'disabled' : ''}>取り直す</button></div>
      <p class="note" style="margin-bottom:0">絞り込みの「日付の基準」で「発売日」を選ぶと、この日付で並びます。詳細には日付の出どころ（CK 公式 / otokoki / 推定）を添えて表示します。発売日が分からない動画も、同じレーベルの前後の品番の発売日から推定できれば「ごろ（推定）」として使います。</p>
      <details class="more"><summary>詳しく</summary><p class="note">COAT グループの作品は、公式配信サイト CK DOWNLOAD の配信日を使います（詳細を開いたときと、収集のついでに 1 日 ${OFFICIAL_PER_DAY} 本まで品番で調べます。1 本あたり約 200KB）。それ以外は、otokoki（ゲイ動画の紹介サイト）が新作の配信に合わせて記事を出すため、その掲載日を発売日の目安にしています（記事に発売日は書かれていませんが、公式の発売日とはおおむね 0〜3 日差です）。どちらでも分からない動画は、同じレーベル（品番の英字部分）で番号が前後する作品の発売日から、番号の比で日付を推定します（前後の両方が分かっていて、番号差 ${ESTIMATE.maxGap} 以内・日付の間が ${ESTIMATE.maxSpanDays} 日以内のときだけ。おおむね数日以内の誤差です）。一覧では日付に「頃」を付けて区別します。掲載元に投稿された日より遅い日付は、再販などの日付とみなして使いません。どれでも分からない動画は「発売日不明」となり、発売日順では後ろに並びます。初回は otokoki の記事のタイトルと日付だけを全件（数 MB）取得します。</p></details>`;
    el.querySelector('[data-act="toggle"]').onclick = async () => {
      await db.kvSet('releaseEnabled', !enabled);
      if (!enabled) collectRelease({ force: true });
      paint();
    };
    el.querySelector('[data-act="refetch"]').onclick = async () => {
      if (!confirm('発売日の対応表（otokoki・公式の配信日）を取り直します。よいですか？')) return;
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
    await db.kvSet('releaseLastRun', Date.now());
    let official = 0;
    try { official = await collectOfficial(); } catch {}
    release.status = `OK（otokoki ${state.release.byTitle.size.toLocaleString()} 件の対応表・公式の配信日 ${countOfficial().toLocaleString()} 本${official ? `（今回 ${official} 本）` : ''}）`;
  } catch (e) {
    release.status = 'エラー: ' + e.message;
  } finally {
    release.running = false;
    rebuild();
    emit('data');
    emit('progress');
  }
}

// 詳細を開いて otokoki の記事が見つかったときに、その動画の発売日の目安を記録する
// （対応表で分かっている動画は上書きしない。品番のある動画はタイトルを記録しない: 同じシリーズ名の別作品に日付が移るため）
export async function noteRelease(video, date) {
  if (!date || video.releaseKnown || !(await db.kvGet('releaseEnabled', true))) return;
  const row = { id: 'v:' + video.key, date, code: video.code ? normalizeCode(video.code) : null, tkey: video.code ? null : releaseTitleKey(video.title) };
  index(row);
  applyRelease(video); // 掲載元の投稿日より遅い日付なら使わない（data.js）
  try { await db.put('release', row); } catch {}
  if (video.releaseKnown) emit('release', video.key);
}

const countOfficial = () => [...checked.values()].filter((r) => r.date).length;

export async function wipeRelease() {
  await db.clear('release');
  knownIds.clear();
  await db.kvSet('releaseBackfillDone', false);
  await db.kvSet('releaseBackfillPage', 1);
  state.release.byCode.clear();
  state.release.byTitle.clear();
  state.release.official.clear();
  checked.clear();
  release.status = null;
  rebuild();
  emit('data');
}
