// ファイル構成の整合性チェック（import 先の実在、Service Worker のキャッシュ漏れ、index.html の参照先）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const appFiles = [...walk('js'), ...walk('css')];

test('import 先のファイルがすべて存在する', () => {
  for (const f of walk('js')) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const [, spec] of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const target = join(dirname(join(root, f)), spec);
      assert.ok(existsSync(target), `${f} の import '${spec}' が見つかりません`);
    }
  }
});

test('Service Worker の SHELL にアプリのファイルがすべて入っている', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  for (const f of appFiles) assert.ok(sw.includes(`'./${f}'`), `sw.js の SHELL に ./${f} がありません`);
  for (const [, p] of sw.matchAll(/'\.\/([^']+\.[a-z]+)'/g)) assert.ok(existsSync(join(root, p)), `sw.js の SHELL の ./${p} が存在しません`);
});

test('index.html が参照する CSS・JS が存在する', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const [, p] of html.matchAll(/(?:href|src)="((?:css|js|icons)\/[^"]+)"/g)) assert.ok(existsSync(join(root, p)), `${p} が存在しません`);
  for (const f of walk('css')) assert.ok(html.includes(`href="${f}"`), `index.html が ${f} を読み込んでいません`);
});
