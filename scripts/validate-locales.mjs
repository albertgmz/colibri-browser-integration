import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const signature = message => [...message.matchAll(/\$(?:[A-Za-z][\w]*|\d+)\$/g)].map(match => match[0].toLowerCase()).sort();
export function validateCatalog(english, translated) {
  for (const [key, entry] of Object.entries(translated)) {
    if (!(key in english)) throw new Error(`${key}: unknown English key`);
    if (typeof entry?.message !== 'string' || !entry.message.trim()) throw new Error(`${key}: empty message; omit untranslated keys`);
    if (JSON.stringify(signature(entry.message)) !== JSON.stringify(signature(english[key].message))) throw new Error(`${key}: changed message placeholders`);
    const expected = english[key].placeholders ?? {};
    const actual = entry.placeholders ?? {};
    if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(actual).sort())) throw new Error(`${key}: changed placeholder names`);
    for (const name of Object.keys(expected)) if (actual[name]?.content !== expected[name].content) throw new Error(`${key}: changed placeholder content`);
  }
}

export function validateLocales(directory) {
  const read = locale => JSON.parse(readFileSync(path.join(directory, locale, 'messages.json'), 'utf8'));
  const english = read('en');
  validateCatalog(english, english);
  for (const locale of readdirSync(directory)) validateCatalog(english, read(locale));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateLocales(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/_locales'));
  process.stdout.write('Locale catalogs valid; missing keys use default English.\n');
}
