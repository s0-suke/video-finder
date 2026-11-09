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

test('import している名前が、相手のモジュールで export されている', () => {
  const exportsOf = (file) => {
    const src = readFileSync(file, 'utf8');
    const names = new Set();
    for (const [, n] of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(n);
    for (const [, list] of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const n of list.split(',')) names.add(n.trim().split(/\s+as\s+/).pop());
    return names;
  };
  for (const f of walk('js')) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const [, list, spec] of src.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
      const target = join(dirname(join(root, f)), spec);
      if (!existsSync(target)) continue; // 存在しないファイルは別のテストで検出
      const names = exportsOf(target);
      for (const raw of list.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (name) assert.ok(names.has(name), `${f} が import している ${name} を ${spec} が export していません`);
      }
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
  for (const [, p] of html.matchAll(/(?:href|src)="((?:css|js|icons)\/[^"?]+)/g)) assert.ok(existsSync(join(root, p)), `${p} が存在しません`);
  for (const f of walk('css')) assert.ok(html.includes(`href="${f}?v=`) || html.includes(`href="${f}"`), `index.html が ${f} を読み込んでいません`);
});

import { expectedIndex } from '../tools/stamp.js';

test('index.html の版番号（import map・CSS・main.js）が最新の中身と合っている（ずれていたら npm run stamp）', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('<script type="importmap">'), 'import map がありません。npm run stamp を実行してください');
  assert.equal(html, expectedIndex(html), '版番号が古いままです。npm run stamp を実行してください');
});
