import { expect, test, vi } from 'vitest';
import { awaitAcceptance, HandoffCoordinator, type HandoffDependencies } from '../src/handoff';
import { DEFAULT_SETTINGS } from '../src/settings';
test('mismatched capture IDs never establish status acceptance', async () => {
  const send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'accepted', accepted: true, captureId: 'other' })
    .mockResolvedValueOnce({ ok: true, state: 'browser', captureId: 'own' });
  expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'own' }, send, async () => {})).toBe('browser');
  expect(send).toHaveBeenLastCalledWith({ type: 'capture-cancel', captureId: 'own' }, 20000);
});
test('concurrent browser events share one local offer and release each callback', async () => {
  const coordinator = new HandoffCoordinator();
  let resolve!: () => void; const waiting = new Promise<void>(done => { resolve = done; });
  const d: HandoffDependencies = { settings: async () => ({ ...DEFAULT_SETTINGS }), observe: () => undefined,
    bypass: () => false, cookies: async () => '', send: vi.fn(async () => ({ ok: true, state: 'accepted', accepted: true })),
    pause: async () => { await waiting; }, resume: vi.fn(async () => {}), cancel: vi.fn(async () => {}), erase: async () => {}, record: async () => {} };
  const item = { id: 1, url: 'https://example.test/a.zip', filename: 'a.zip' }; const first = vi.fn(), second = vi.fn();
  const one = coordinator.run(item, d, first), two = coordinator.run(item, d, second); resolve(); await Promise.all([one, two]);
  expect(d.send).toHaveBeenCalledTimes(1); expect(d.cancel).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
});
