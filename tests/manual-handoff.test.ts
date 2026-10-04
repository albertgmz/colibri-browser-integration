import { expect, test, vi } from 'vitest';
import { manualHandoff } from '../src/manual-handoff';
import { DEFAULT_SETTINGS } from '../src/settings';
const url = 'https://example.test/file.zip';
function deps() {
  return { hello: vi.fn(async () => ({ ok: true, protocolVersion: 2, capabilities: ['capture-confirmation'] })),
    settings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, enabled: false, minSizeKiB: 100000 })),
    cookies: vi.fn(async () => 'fixture'), send: vi.fn(async (message: Record<string, unknown>) => { void message; return { ok: true, state: 'accepted', accepted: true }; }) };
}
test('a deliberate link offer can override automatic preferences and still asks desktop confirmation', async () => {
  const d = deps(); expect(await manualHandoff(url, 'https://page.test/', false, d)).toBe('accepted');
  expect(d.settings).toHaveBeenCalledTimes(1); expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'add', url }));
  expect(d.send.mock.calls[0]?.[0]).not.toHaveProperty('captureAction');
});
test('current scoped type exclusions and private restrictions precede cookies and submission', async () => {
  const d = deps(); d.settings = vi.fn(async () => ({ ...DEFAULT_SETTINGS, exclusionRules: ['type:zip'] }));
  expect(await manualHandoff(url, 'https://page.test/', false, d)).toBe('excluded');
  expect(d.cookies).not.toHaveBeenCalled(); expect(d.send).not.toHaveBeenCalled();
  expect(await manualHandoff(url, 'https://page.test/', true, deps())).toBe('private');
});
test('unavailable current configuration and incompatible hosts never get credentials', async () => {
  const d = deps(); d.settings = vi.fn(async () => { throw new Error('unavailable'); });
  expect(await manualHandoff(url, '', false, d)).toBe('incompatible'); expect(d.cookies).not.toHaveBeenCalled();
  const old = deps(); old.hello = vi.fn(async () => ({ ok: true, protocolVersion: 1, capabilities: [] }));
  expect(await manualHandoff(url, '', false, old)).toBe('incompatible'); expect(old.settings).not.toHaveBeenCalled();
});
test('closing preparation while settings load prevents cookies and add', async () => {
  let valid = true; const d = deps();
  d.settings = vi.fn(async () => { valid = false; return { ...DEFAULT_SETTINGS }; });
  expect(await manualHandoff(url, '', false, { ...d, valid: () => valid })).toBe('expired');
  expect(d.cookies).not.toHaveBeenCalled(); expect(d.send).not.toHaveBeenCalled();
});
test('closing preparation during cookie collection prevents the native offer', async () => {
  let valid = true; const d = deps(); d.cookies = vi.fn(async () => { valid = false; return 'fixture'; });
  expect(await manualHandoff(url, '', false, { ...d, valid: () => valid })).toBe('expired');
  expect(d.send).not.toHaveBeenCalled();
});
