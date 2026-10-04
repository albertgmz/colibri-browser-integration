import { expect, test, vi } from 'vitest';
import { handoff, type HandoffDependencies } from '../src/handoff';
import { DEFAULT_SETTINGS } from '../src/settings';
const item = { id: 2, url: 'https://example.com/a.zip', filename: 'a.zip', incognito: false };
function dependencies(): HandoffDependencies {
  return { settings: async () => ({ ...DEFAULT_SETTINGS }), observe: () => ({ url: item.url, method: 'GET', tabId: 1, at: Date.now() }), bypass: () => false, cookies: async () => '', send: vi.fn().mockResolvedValue({ ok: true, state: 'accepted', accepted: true }), pause: vi.fn().mockResolvedValue(undefined), resume: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), erase: vi.fn().mockResolvedValue(undefined), record: vi.fn().mockResolvedValue(undefined), requireObservation: true };
}
test('POST capture bypasses native messaging and leaves browser untouched', async () => {
  const deps = dependencies(); deps.observe = () => ({ url: item.url, method: 'POST', tabId: 1, at: Date.now() });
  await handoff(item, deps); expect(deps.pause).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
});
test('unobserved downloads remain in the browser', async () => {
  const deps = dependencies(); deps.observe = () => undefined; await handoff(item, deps); expect(deps.send).not.toHaveBeenCalled();
});
test('site exclusions cover the source page as well as the download host', async () => {
  const deps = dependencies(); deps.settings = async () => ({ ...DEFAULT_SETTINGS, excludedSites: ['page.example'] }); await handoff({ ...item, referrer: 'https://page.example/a' }, deps); expect(deps.send).not.toHaveBeenCalled();
});
test('configured modifier keeps the download in the browser', async () => {
  const deps = dependencies(); deps.settings = async () => ({ ...DEFAULT_SETTINGS, bypassModifier: 'alt' }); deps.bypass = () => true; await handoff(item, deps); expect(deps.send).not.toHaveBeenCalled();
});
test('private capture requires app opt-in and uses the private cookie store', async () => {
  const deps = dependencies(); deps.cookies = vi.fn().mockResolvedValue(''); await handoff({ ...item, incognito: true }, deps); expect(deps.cookies).not.toHaveBeenCalled();
  deps.settings = async () => ({ ...DEFAULT_SETTINGS, capturePrivate: true }); await handoff({ ...item, incognito: true }, deps); expect(deps.cookies).toHaveBeenCalledWith(item.url, true); expect(deps.cancel).toHaveBeenCalledWith(2);
});
test('pause failure never offers a browser download to the app', async () => {
  const deps = dependencies(); deps.pause = vi.fn().mockRejectedValue(new Error('not resumable')); await handoff(item, deps); expect(deps.send).not.toHaveBeenCalled();
});
test('pending confirmation stays paused until accepted', async () => {
  const deps = dependencies(); deps.wait = async () => { expect(deps.cancel).not.toHaveBeenCalled(); };
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' }).mockResolvedValueOnce({ ok: true, state: 'accepted', accepted: true }); await handoff(item, deps); expect(deps.cancel).toHaveBeenCalledWith(2); expect(deps.resume).not.toHaveBeenCalled();
});
test('acceptance winning a cancellation race cancels browser instead of resuming it', async () => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValueOnce({ ok: false, error: 'timeout' })
    .mockResolvedValueOnce({ ok: true, state: 'accepted', accepted: true });
  await handoff(item, deps);
  expect(deps.cancel).toHaveBeenCalledWith(item.id); expect(deps.resume).not.toHaveBeenCalled();
});
test('disconnect without confirmed ownership resumes the browser copy', async () => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValue({ ok: false, error: 'native' });
  await handoff(item, deps);
  expect(deps.cancel).not.toHaveBeenCalled(); expect(deps.resume).toHaveBeenCalledWith(item.id);
});

test('authoritative pending cancellation keeps the browser paused and records attention', async () => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValueOnce({ ok: false, error: 'timeout' })
    .mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id', accepted: false });
  const released = vi.fn();
  await handoff(item, deps, released);
  expect(deps.pause).toHaveBeenCalledWith(item.id);
  expect(deps.resume).not.toHaveBeenCalled();
  expect(deps.cancel).not.toHaveBeenCalled();
  expect(deps.erase).not.toHaveBeenCalled();
  expect(deps.send).toHaveBeenLastCalledWith({ type: 'capture-cancel', captureId: 'id' }, 20_000);
  expect(released).toHaveBeenCalledTimes(1);
  expect(deps.record).toHaveBeenLastCalledWith({ fileName: 'a.zip', state: 'attention', at: expect.any(Number) });
});

test('history storage failure after pending cancellation does not release the paused browser', async () => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValueOnce({ ok: true, state: 'rejected' })
    .mockResolvedValueOnce({ ok: true, state: 'pending' });
  deps.record = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage failed'));
  await handoff(item, deps);
  expect(deps.resume).not.toHaveBeenCalled();
  expect(deps.cancel).not.toHaveBeenCalled();
});

test.each([
  { ok: true, state: 'rejected' }, { ok: true, state: 'browser' },
  { ok: false, state: 'pending', error: 'timeout' }, { state: 'pending' },
  { ok: true, state: 'pending', captureId: 'other' },
  { ok: true, state: 'pending', accepted: true }, { ok: true, state: 'unknown' },
])('non-authoritative or terminal cancellation resumes browser (%j)', async canceled => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValueOnce({ ok: false, error: 'native' }).mockResolvedValueOnce(canceled);
  await handoff(item, deps);
  expect(deps.resume).toHaveBeenCalledWith(item.id);
  expect(deps.cancel).not.toHaveBeenCalled();
  expect(deps.record).toHaveBeenLastCalledWith({ fileName: 'a.zip', state: 'browser', at: expect.any(Number) });
});

test('cancellation transport exception falls back instead of holding the browser indefinitely', async () => {
  const deps = dependencies(); deps.wait = async () => {};
  deps.send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'id' })
    .mockResolvedValueOnce({ ok: false, error: 'native' }).mockRejectedValueOnce(new Error('native disconnected'));
  await handoff(item, deps);
  expect(deps.resume).toHaveBeenCalledWith(item.id);
  expect(deps.cancel).not.toHaveBeenCalled();
});
