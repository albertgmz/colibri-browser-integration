import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const messages = JSON.parse(read('../public/_locales/en/messages.json'));
const manifest = JSON.parse(read('../manifest.base.json'));
test('the manifest takes its name, description and button title from the locale', () => {
  for (const text of [manifest.name, manifest.description, manifest.action.default_title]) {
    const key = /^__MSG_(\w+)__$/.exec(text)?.[1]; assert.ok(key); assert.ok(messages[key]);
  }
});
test('every message key used by the extension exists', () => {
  const files = ['src', 'entrypoints'].flatMap(folder => readdirSync(new URL(`../${folder}`, import.meta.url), { recursive: true }).map(file => `${folder}/${String(file).replaceAll('\\', '/')}`)).filter(file => /\.(ts|html)$/.test(file));
  const sources = files.map(file => read(`../${file}`)).join('\n');
  const used = [...sources.matchAll(/(?:data-i18n="|getMessage\(['"]|text\(['"])(\w+)/g)].map(match => match[1]);
  assert.ok(files.includes('entrypoints/popup/main.ts') && files.includes('src/background.ts'));
  assert.ok(used.includes('contextMenuDownload'));
  for (const key of used) assert.ok(messages[key], `missing message ${key}`);
});
