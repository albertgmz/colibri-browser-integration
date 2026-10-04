import { expect, test } from 'vitest';
import { validateCatalog, validateLocales } from '../scripts/validate-locales.mjs';

test('all bundled browser locale catalogs validate', () => validateLocales('public/_locales'));
test('partial translation preserves browser placeholders', () => {
  const english = { greeting: { message: 'Hello' }, size: { message: '$size$', placeholders: { size: { content: '$1' } } } };
  expect(() => validateCatalog(english, { size: { message: '$size$ octets', placeholders: { size: { content: '$1' } } } })).not.toThrow();
  for (const entry of [{ extra: { message: 'extra' } }, { greeting: { message: '' } }, { size: { message: 'size' } },
    { size: { message: '$size$', placeholders: { size: { content: '$2' } } } }]) {
    expect(() => validateCatalog(english, entry)).toThrow();
  }
});
