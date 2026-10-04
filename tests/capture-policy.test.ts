import { expect, test } from 'vitest';
import { decideCapture, rulesFromConfig } from '../src/capture';
import { exclusionMatches, normalizedExclusion } from '../src/generated/capture-rules';
const policy = { categories: { programs: 'capture', other: 'ask' }, extensions: { exe: 'browser' } } as const;
test('browser suggested filename wins MIME/URL conflicts and unknown sizes still ask', () => {
  const rules = { extensions: [], minSizeKiB: 4096, capturePolicy: policy };
  expect(decideCapture({ enabled: true, rules, item: { id: 1, url: 'https://example.com/fake.pdf', filename: 'real.apk', mime: 'application/pdf', totalBytes: -1 } })).toEqual({ capture: true, action: 'capture' });
  expect(decideCapture({ enabled: true, rules, item: { id: 1, url: 'https://example.com/a.exe', filename: 'real.neverlisted', totalBytes: -1 } })).toEqual({ capture: true, action: 'ask' });
  expect(decideCapture({ enabled: true, rules, item: { id: 1, url: 'https://example.com/a.exe', filename: 'real.exe' } }).capture).toBe(false);
});
test('scoped exclusions use host boundary and path subtree, never query', () => {
  expect(exclusionMatches('domain:example.com', 'https://a.example.com/file?secret=1')).toBe(true);
  expect(exclusionMatches('domain:example.com', 'https://notexample.com/file')).toBe(false);
  expect(exclusionMatches('path:example.com/files', 'https://example.com/files/a')).toBe(true);
  expect(exclusionMatches('path:example.com/files', 'https://example.com/files-extra/a')).toBe(false);
  expect(normalizedExclusion('path:example.com/files?secret=1')).toBe(null);
  expect(rulesFromConfig({ ok: true, captureExtensions: [], minSizeKiB: 0, capturePolicy: { categories: { other: 'invalid' }, extensions: {} } })).toBe(null);
});
