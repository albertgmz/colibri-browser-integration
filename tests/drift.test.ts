import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
const appRoot = process.env.COLIBRI_APP_ROOT ?? resolve('..', 'Colibri');
const canonical = resolve(appRoot, 'docs/protocol.schema.json');
test.skipIf(!existsSync(canonical))('protocol schema and generated design tokens match the app-owned canonical files', () => {
  expect(JSON.parse(readFileSync('docs/protocol.schema.json', 'utf8'))).toEqual(JSON.parse(readFileSync(canonical, 'utf8')));
  expect(JSON.parse(readFileSync('docs/design-tokens.json', 'utf8'))).toEqual(JSON.parse(readFileSync(resolve(appRoot, 'docs/design-tokens.json'), 'utf8')));
  expect(JSON.parse(readFileSync('docs/capture-policy.json', 'utf8'))).toEqual(JSON.parse(readFileSync(resolve(appRoot, 'docs/capture-policy.json'), 'utf8')));
  expect(readFileSync('src/generated/capture-rules.ts', 'utf8').replaceAll('\r\n', '\n')).toBe(readFileSync(resolve(appRoot, 'docs/capture-rules.ts'), 'utf8').replaceAll('\r\n', '\n'));
  expect(readFileSync('src/generated/capture-catalog.ts', 'utf8').replaceAll('\r\n', '\n')).toBe(readFileSync(resolve(appRoot, 'docs/capture-catalog.ts'), 'utf8').replaceAll('\r\n', '\n'));
  expect(readFileSync('assets/tokens.css', 'utf8').replaceAll('\r\n', '\n')).toBe(readFileSync(resolve(appRoot, 'docs/design-tokens.css'), 'utf8').replaceAll('\r\n', '\n'));
});
