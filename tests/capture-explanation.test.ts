import { expect, test, vi } from 'vitest';
import { sanitizeExplanation, policySummary } from '../src/capture-explanation';
import { DEFAULT_SETTINGS } from '../src/settings';
import { handoff, type HandoffDependencies } from '../src/handoff';

test('explanations retain only recognized codes and never context or credentials', () => {
  expect(sanitizeExplanation({ kind: 'policy', reason: 'excluded', outcome: 'browser', url: 'https://example.test/?signed=fixture', cookies: 'fixture' }))
    .toEqual({ kind: 'policy', reason: 'excluded', outcome: 'browser' });
  expect(sanitizeExplanation({ kind: 'policy', reason: 'https://secret.test/', outcome: 'accepted' })).toEqual({ kind: 'policy', outcome: 'accepted' });
  expect(sanitizeExplanation({ kind: 'unknown', reason: 'disabled' })).toBeUndefined();
  expect(sanitizeExplanation({ kind: ['policy'], outcome: ['accepted'] })).toBeUndefined();
  expect(sanitizeExplanation({ kind: 'policy', reason: {}, outcome: ['accepted'] })).toEqual({ kind: 'policy' });
});
test('category summaries use canonical IDs and preserve legacy-policy distinction', () => {
  expect(policySummary(DEFAULT_SETTINGS)).toEqual({ legacy: true, rows: [], overrides: 0 });
  const summary = policySummary({ ...DEFAULT_SETTINGS, capturePolicy: { categories: { programs: 'browser', other: 'ask' }, extensions: { apk: 'capture' } } });
  expect(summary.rows.find(row => row.id === 'programs')?.action).toBe('browser');
  expect(summary.overrides).toBe(1); expect(summary.legacy).toBe(false);
});
function deps(): HandoffDependencies {
  return { settings: async () => ({ ...DEFAULT_SETTINGS }), observe: () => undefined, bypass: () => false,
    cookies: async () => '', send: vi.fn(async () => ({ ok: true, accepted: true, state: 'accepted' })),
    pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), cancel: vi.fn(async () => {}), erase: vi.fn(async () => {}),
    record: vi.fn(async () => {}), explain: vi.fn() };
}
const item = { id: 1, url: 'https://example.test/file.zip?sig=fixture', filename: 'file.zip' };
test('disabled capture reports a canonical reason without creating an offer', async () => {
  const d = deps(); d.settings = async () => ({ ...DEFAULT_SETTINGS, enabled: false });
  await handoff(item, d);
  expect(d.explain).toHaveBeenCalledWith({ kind: 'policy', reason: 'disabled', outcome: 'browser' });
  expect(d.send).not.toHaveBeenCalled();
});
test('private capture never writes filename history or global explanation', async () => {
  const d = deps(); d.settings = async () => ({ ...DEFAULT_SETTINGS, capturePrivate: true });
  await handoff({ ...item, incognito: true }, d);
  expect(d.record).not.toHaveBeenCalled(); expect(d.explain).not.toHaveBeenCalled();
  expect(d.cancel).toHaveBeenCalledWith(1);
});
test('unconfirmed host replies show fallback and never authoritative acceptance', async () => {
  const d = deps(); d.send = vi.fn(async () => ({ ok: true }));
  await handoff(item, d);
  expect(d.explain).toHaveBeenLastCalledWith({ kind: 'handoff', outcome: 'browser' });
  expect(d.cancel).not.toHaveBeenCalled(); expect(d.resume).toHaveBeenCalledWith(1);
});
test.each([true, false])('observer failures never change ownership (accepted=%s)', async accepted => {
  const d = deps(); d.explain = () => { throw new Error('observer failed'); };
  d.send = vi.fn(async () => accepted ? { ok: true, accepted: true, state: 'accepted' } : { ok: true });
  await handoff(item, d);
  if (accepted) { expect(d.cancel).toHaveBeenCalledWith(1); expect(d.resume).not.toHaveBeenCalled(); }
  else { expect(d.cancel).not.toHaveBeenCalled(); expect(d.resume).toHaveBeenCalledWith(1); }
});
