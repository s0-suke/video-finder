// レーベル公式サイトのサンプル画像（HTML は CORS で読めないので、品番から画像 URL を組み立て、読めたものだけ使う）

import { videoCode } from './otokoki.js';

// ───────────── レーベルのサンプル画像 ─────────────
//
// 調べた規則（2026-11 時点。Referer があると 403 になるサイトがあるので、読むときは必ず no-referrer）
//   HUNK CHANNEL（hunk-ch.com。G@MES・西麻布撮影所・CRUISING など多数のレーベルを扱う）
//     https://www.hunk-ch.com/video/img/{接頭辞}/{品番}/{品番}_big01.jpg 〜 _big20 前後
//     品番は小文字。DL 版は「cr-0885_dl」、G@MES 系（OAV・OGP・DT など）は「gv/gv-oav463(_dl)」の形になる
//   ACCEED（acceed.jp）
//     https://acceed.jp/pic_base/product/ACST435/thumb/ACST435_001_b.jpg 〜 _044_b（853×480）
//   Men's Rush.TV（mensrush.tv）… 場面写真の URL は連番でない ID を含むので組み立てられない。ジャケットだけ取れる
//     https://img.mensrush.tv/goods/gt-2720_dl/gt-2720_dl.webp

const PREVIEW_CHUNK = 12; // 連番の画像を一度に確かめる枚数
const previewMemo = new Map(); // video.key -> Promise<string[]>

// alive() が false になったら（詳細を閉じた・別の動画へ移った）残りの確認を打ち切る。空の結果や打ち切りは覚えない
export function getPreviews(video, alive = () => true) {
  if (!previewMemo.has(video.key)) {
    const p = loadPreviews(video, alive).then((urls) => {
      if (!urls.length || !alive()) previewMemo.delete(video.key);
      return urls;
    });
    previewMemo.set(video.key, p);
  }
  return previewMemo.get(video.key);
}

// 品番から試す画像の候補。at(i) は i 枚目（1 始まり）の URL
function previewSources(rawCode) {
  // 「OAV463」「MR-KR2391」「CR-0885_DL」→ 接頭辞と残りに分ける
  const m = String(rawCode).normalize('NFKC').toUpperCase().replace(/[_-]DL$/, '')
    .match(/^([A-Z]{2,8})[-_ ]?([A-Z]{0,6}[-_]?\d{2,8})$/);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  const rest = m[2].toLowerCase().replace(/_/g, '-');
  const code = prefix + '-' + rest; // 例: cr-0885、mr-kr2391
  const flat = (prefix + rest).replace(/-/g, ''); // 例: oav463
  const pad = (i, n) => String(i).padStart(n, '0');
  const hunk = (dir, base) => (i) => `https://www.hunk-ch.com/video/img/${dir}/${base}/${base}_big${pad(i, 2)}.jpg`;
  const list = [
    // 同じ作品の置き場所の候補。最初に見つかった 1 つだけ使う
    { group: 'hunk', max: 30, at: hunk(prefix, code) },
    { group: 'hunk', max: 30, at: hunk(prefix, code + '_dl') },
    { group: 'hunk', max: 30, at: hunk('gv', 'gv-' + flat) },
    { group: 'hunk', max: 30, at: hunk('gv', 'gv-' + flat + '_dl') },
    { group: 'mensrush', max: 1, at: () => `https://img.mensrush.tv/goods/${code}_dl/${code}_dl.webp` },
  ];
  // ACCEED は存在しないと 160KB の HTML が返るので、ACCEED の品番だけ試す
  if (/^ac/.test(prefix)) {
    const up = flat.toUpperCase();
    list.push({ group: 'acceed', max: 48, at: (i) => `https://acceed.jp/pic_base/product/${up}/thumb/${up}_${pad(i, 3)}_b.jpg` });
  }
  return list;
}

async function loadPreviews(video, alive) {
  const list = previewSources(videoCode(video));
  if (!list.length) return [];
  // まず各候補の 1 枚目を同時に確かめ、グループごとに最初に見つかった候補を使う
  const firsts = await Promise.all(list.map((s) => probeImage(s.at(1))));
  const chosen = new Map();
  list.forEach((s, i) => { if (firsts[i] && !chosen.has(s.group)) chosen.set(s.group, s); });
  const results = await Promise.all([...chosen.values()].map(async (s) => {
    const urls = [s.at(1)];
    // 2 枚目以降は PREVIEW_CHUNK 枚ずつ確かめ、欠けが出たらそこで終わり
    for (let start = 2; start <= s.max; start += PREVIEW_CHUNK) {
      if (!alive()) break;
      const idx = [];
      for (let i = start; i < start + PREVIEW_CHUNK && i <= s.max; i++) idx.push(i);
      const ok = await Promise.all(idx.map((i) => probeImage(s.at(i))));
      idx.forEach((i, k) => { if (ok[k]) urls.push(s.at(i)); });
      if (ok.some((v) => !v)) break;
    }
    return urls;
  }));
  return results.flat();
}

// 画像として読めて、アイコンでない大きさなら true（ブラウザのキャッシュに載るので、表示するときは再取得しない）
function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, 15000);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth >= 160 && img.naturalHeight >= 90); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

