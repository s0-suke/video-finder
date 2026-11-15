// 利用データの集計（純粋関数。テストできるように analytics.js から分けてある）
//
// 記録するのは「どこをどう操作したか」だけ（タブ・ボタンの種類、動画を開いた経路、再生までの回数と時間）。
// 検索語・動画のタイトル・出演者名は記録しない（検索は文字数と件数だけ）。端末の外には出ない。
//
// イベントの形: { t: ミリ秒, e: 種類, …項目 }
//   launch  起動（v: 版）
//   view    画面を開いた（page: 'home:new' など）
//   tap     操作（k: 'tab:home' / 'card' / 'act:history' など, at: 画面）
//   open    動画の詳細を開いた（src: どの画面から, taps / scroll / ms: 起動からの累計, newV: 新着か）
//   play    再生した（taps / scroll / ms: 起動からの累計）
//   fav     動画のお気に入りを付け外した（on, src）
//   search  検索した（len: 文字数, n: 件数, at: 画面）
//   leave   画面を離れた（page, maxY: その画面で一番下までスクロールした量 px, screens: 画面何枚ぶんか）

export const GAP = 30 * 60 * 1000; // この時間あいたら、別の起動として数える

/** イベント列を、起動ごとのまとまりに分ける（launch で区切る。launch がなくても時間があけば区切る） */
export function sessions(events) {
  const out = [];
  let cur = null;
  for (const ev of events) {
    if (!cur || ev.e === 'launch' || ev.t - cur.last > GAP) {
      cur = { start: ev.t, last: ev.t, events: [] };
      out.push(cur);
    }
    cur.events.push(ev);
    cur.last = ev.t;
  }
  return out;
}

const first = (list, e) => list.find((x) => x.e === e);
const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};
const count = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, key || 8).map(([k, n]) => ({ k, n }));
};

/** 1 回の起動の要約 */
export function summarizeSession(s) {
  const o = first(s.events, 'open');
  const p = first(s.events, 'play');
  const firstView = first(s.events, 'view');
  return {
    start: new Date(s.start).toISOString(),
    firstView: firstView ? firstView.page : null,
    taps: s.events.filter((x) => x.e === 'tap').length,
    opens: s.events.filter((x) => x.e === 'open').length,
    plays: s.events.filter((x) => x.e === 'play').length,
    favs: s.events.filter((x) => x.e === 'fav' && x.on).length,
    toFirstOpen: o ? { taps: o.taps, scrollPx: o.scroll, sec: Math.round(o.ms / 1000), src: o.src } : null,
    toFirstPlay: p ? { taps: p.taps, scrollPx: p.scroll, sec: Math.round(p.ms / 1000) } : null,
    path: s.events.filter((x) => x.e === 'view' || x.e === 'open' || x.e === 'play').slice(0, 12).map((x) => (x.e === 'view' ? x.page : x.e === 'open' ? `open(${x.src})` : 'play')),
  };
}

/** 全体の集計（課題の分析に使う） */
export function summarize(events) {
  const ss = sessions(events).map((s) => ({ s, sum: summarizeSession(s) }));
  const sums = ss.map((x) => x.sum);
  const opened = sums.filter((x) => x.toFirstOpen);
  const played = sums.filter((x) => x.toFirstPlay);
  const opens = events.filter((x) => x.e === 'open');
  const leaves = events.filter((x) => x.e === 'leave');
  const byPage = new Map();
  for (const l of leaves) {
    const a = byPage.get(l.page) || [];
    a.push(l.screens || 0);
    byPage.set(l.page, a);
  }
  return {
    sessions: sums.length,
    events: events.length,
    from: events.length ? new Date(events[0].t).toISOString() : null,
    to: events.length ? new Date(events[events.length - 1].t).toISOString() : null,
    // 起動してから最初に動画を開く / 再生するまで（タップ数・スクロール量・秒）
    toFirstOpen: {
      sessionsWith: opened.length,
      tapsAvg: avg(opened.map((x) => x.toFirstOpen.taps)),
      tapsMedian: median(opened.map((x) => x.toFirstOpen.taps)),
      scrollPxMedian: median(opened.map((x) => x.toFirstOpen.scrollPx)),
      secMedian: median(opened.map((x) => x.toFirstOpen.sec)),
    },
    toFirstPlay: {
      sessionsWith: played.length,
      tapsAvg: avg(played.map((x) => x.toFirstPlay.taps)),
      tapsMedian: median(played.map((x) => x.toFirstPlay.taps)),
      scrollPxMedian: median(played.map((x) => x.toFirstPlay.scrollPx)),
      secMedian: median(played.map((x) => x.toFirstPlay.sec)),
    },
    firstViewCounts: count(sums.map((x) => x.firstView).filter(Boolean)),
    openSources: count(opens.map((x) => x.src)),
    opensFromNew: opens.filter((x) => x.newV).length,
    opensTotal: opens.length,
    taps: count(events.filter((x) => x.e === 'tap').map((x) => x.k), 12),
    favOn: events.filter((x) => x.e === 'fav' && x.on).length,
    favOff: events.filter((x) => x.e === 'fav' && !x.on).length,
    favSources: count(events.filter((x) => x.e === 'fav' && x.on).map((x) => x.src)),
    searches: events.filter((x) => x.e === 'search').length,
    // 画面ごとに、平均で画面何枚ぶんスクロールしたか
    scrollScreensAvg: Object.fromEntries([...byPage].map(([k, v]) => [k, avg(v)])),
  };
}

/** 書き出すオブジェクト（Claude に読ませる用。定義も一緒に入れる） */
export function buildExport(events, meta, { maxEvents = 1500, maxSessions = 60 } = {}) {
  const all = sessions(events);
  return {
    schema: 'video-finder-usage/1',
    exportedAt: new Date().toISOString(),
    ...meta,
    definitions: {
      privacy: '検索語・タイトル・出演者名は含まない。端末の外には自動では出ない（この書き出しを自分で共有したときだけ）',
      taps: '起動からのタップ数（ボタン・タブ・カードなど。入力の文字数は含まない）',
      scrollPx: '起動からの縦スクロールの累計（px。横に並んだ行の横スクロールは含まない）',
      sec: '起動から経過した秒',
      toFirstOpen: '起動してから最初に動画の詳細を開くまで',
      toFirstPlay: '起動してから最初に再生するまで',
      events: 'launch / view / tap / open / play / fav / search / leave（t はミリ秒）',
    },
    summary: summarize(events),
    sessions: all.slice(-maxSessions).map(summarizeSession),
    events: events.slice(-maxEvents),
  };
}
