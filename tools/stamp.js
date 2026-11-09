// 各ファイルの中身から短い版番号（ハッシュ）を作り、index.html の import map と CSS・main.js の URL に付ける。
// ブラウザ（iOS Safari を含む）は同じ URL の JS をメモリに持ち続けて Service Worker を通さずに使うことがあるので、
// 中身が変わったら URL も変わるようにして、更新後に古いモジュールが混ざらないようにする。
//
// 使い方: npm run stamp（JS / CSS を変えたら実行。npm test が付け忘れを検出する）

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});

export const hashOf = (file) => createHash('sha1').update(readFileSync(join(root, file))).digest('hex').slice(0, 8);

export function expectedIndex(html) {
  const js = walk('js').filter((f) => f.endsWith('.js')).sort();
  const map = { imports: Object.fromEntries(js.map((f) => [`./${f}`, `./${f}?v=${hashOf(f)}`])) };
  const block = `<!-- stamp:importmap -->\n<script type="importmap">\n${JSON.stringify(map, null, 2)}\n</script>\n<!-- /stamp:importmap -->`;
  let out = html.replace(/<!-- stamp:importmap -->[\s\S]*?<!-- \/stamp:importmap -->/, block);
  out = out.replace(/(href|src)="((?:css|js)\/[^"?]+)(?:\?v=[0-9a-f]+)?"/g, (_, attr, path) => `${attr}="${path}?v=${hashOf(path)}"`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(root, 'index.html');
  const html = readFileSync(file, 'utf8');
  if (!html.includes('<!-- stamp:importmap -->')) throw new Error('index.html に <!-- stamp:importmap --> の目印がありません');
  const out = expectedIndex(html);
  writeFileSync(file, out);
  console.log(out === html ? '変更なし' : 'index.html の版番号を更新しました');
}
