import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { settingsFromReply } from '../src/settings';
vi.mock('wxt/browser', () => ({ browser: { i18n: { getMessage: () => '' } } }));
import { applyTheme } from '../src/ui';

test.each(['warm', 'graphite', 'ocean', 'forest'] as const)('config retains independent theme/accent for %s', palette => {
  const settings = settingsFromReply({ ok: true, captureExtensions: ['zip'], minSizeKiB: 0,
    theme: 'light', accent: '#C77800', palette });
  expect(settings).toMatchObject({ palette, theme: 'light', accent: '#C77800' });
  const element = { dataset: {} as Record<string,string>, style: { setProperty: vi.fn() } };
  vi.stubGlobal('document', { documentElement: element });
  try {
    applyTheme(settings!);
    expect(element.dataset).toEqual({ theme: 'light', palette });
    expect(element.style.setProperty).toHaveBeenCalledWith('--colibri-accent', '#C77800');
  } finally { vi.unstubAllGlobals(); }
});

test.each([undefined, null, 'future', 4, {}, []])('old/invalid palette %j falls back without losing capture preferences', palette => {
  expect(settingsFromReply({ ok: true, captureExtensions: ['zip'], minSizeKiB: 12, enabled: false,
    theme: 'dark', accent: '#0078D4', palette })).toMatchObject({ palette: 'warm', theme: 'dark', accent: '#0078D4', enabled: false, minSizeKiB: 12 });
});

test('generated CSS keeps explicit light after system-dark and converts Avalonia alpha ordering', () => {
  const css = readFileSync('assets/tokens.css', 'utf8');
  const tokens = JSON.parse(readFileSync('docs/design-tokens.json', 'utf8'));
  for (const id of ['warm', 'graphite', 'ocean', 'forest']) {
    const base = css.indexOf(`:root[data-palette="${id}"] {`);
    const system = css.indexOf(`@media (prefers-color-scheme: dark) { :root[data-palette="${id}"] {`);
    const light = css.indexOf(`:root[data-palette="${id}"][data-theme="light"] {`);
    expect(base).toBeGreaterThan(0); expect(system).toBeGreaterThan(base); expect(light).toBeGreaterThan(system);
    expect(css.slice(light, css.indexOf('}', light))).toContain(`--colibri-chrome: ${tokens.palettes[id].light.chrome};`);
    const mica = tokens.palettes[id].dark.mica as string;
    expect(css).toContain(`--colibri-mica: #${mica.slice(3)}${mica.slice(1,3)};`);
  }
  expect(tokens.light).toEqual(tokens.palettes.warm.light);
  expect(tokens.dark).toEqual(tokens.palettes.warm.dark);
});
