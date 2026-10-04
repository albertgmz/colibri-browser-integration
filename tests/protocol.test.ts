import { describe, expect, test, vi } from 'vitest';
import { NativeClient, type NativePort } from '../src/native';
import { awaitAcceptance } from '../src/handoff';
import { RequestTracker } from '../src/request-context';
import { DEFAULT_SETTINGS, settingsFromReply, siteExcluded } from '../src/settings';

function fakePort() {
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect = () => {};
  const sent: Record<string, unknown>[] = [];
  const port: NativePort = {
    postMessage: message => { sent.push(message as Record<string, unknown>); }, disconnect: () => onDisconnect(),
    onMessage: { addListener: listener => { onMessage = listener; } },
    onDisconnect: { addListener: listener => { onDisconnect = listener; } },
  };
  return { port, sent, reply: (message: unknown) => onMessage(message) };
}
describe('persistent native protocol', () => {
  test('closed preparation during a native handshake never posts the offer', async () => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port); let valid = true;
    const result = client.send({ type: 'add', cookies: 'fixture' }, 20000, () => valid);
    valid = false; fake.reply({ requestId: fake.sent[0]?.requestId, ok: true, protocolVersion: 2, capabilities: ['capture-confirmation'] });
    expect((await result).ok).toBe(false); expect(fake.sent).toHaveLength(1);
  });
  const closedReply = { ok: false, error: 'app-not-running', protocolVersion: 2, capabilities: ['capture-confirmation'] };
  test.each(['add', 'bulk-add', 'open'])('compatible closed hello allows intentional %s and is not cached', async type => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port);
    const result = client.send({ type });
    fake.reply({ ...closedReply, requestId: fake.sent[0]?.requestId });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fake.sent[1]?.type).toBe(type);
    fake.reply({ ok: true, requestId: fake.sent[1]?.requestId });
    expect((await result).ok).toBe(true);
    const hello = client.hello();
    expect(fake.sent[2]?.type).toBe('hello');
    fake.reply({ ...closedReply, requestId: fake.sent[2]?.requestId });
    expect((await hello).error).toBe('app-not-running');
  });
  test.each(['ping', 'config', 'settings-update', 'capture-status', 'capture-cancel', 'unknown'])('closed hello does not forward %s', async type => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port);
    const result = client.send({ type });
    fake.reply({ ...closedReply, requestId: fake.sent[0]?.requestId });
    expect((await result).error).toBe('app-not-running'); expect(fake.sent).toHaveLength(1);
  });
  test.each([
    { ...closedReply, protocolVersion: 1 },
    { ...closedReply, protocolVersion: undefined },
    { ...closedReply, capabilities: [] },
    { ...closedReply, capabilities: 'capture-confirmation' },
    { ...closedReply, error: 'timeout' },
    { ...closedReply, ok: undefined },
  ])('unverified closed handshake never forwards a credential payload (%j)', async reply => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port);
    const result = client.send({ type: 'add', cookies: 'secret' });
    fake.reply({ ...reply, requestId: fake.sent[0]?.requestId });
    expect((await result).ok).toBe(false); expect(fake.sent).toHaveLength(1);
  });
  test('hello versions and capabilities precede correlated concurrent requests', async () => {
    const fake = fakePort(); const connect = vi.fn(() => fake.port); const client = new NativeClient(connect);
    const hello = client.hello(); expect(fake.sent[0]?.type).toBe('hello');
    fake.reply({ requestId: fake.sent[0]?.requestId, ok: true, protocolVersion: 2, capabilities: ['capture-confirmation'] });
    await hello;
    const first = client.send({ type: 'config' }); const second = client.send({ type: 'open' });
    await new Promise(resolve => setTimeout(resolve, 0));
    fake.reply({ requestId: fake.sent[2]?.requestId, ok: true, state: 'second' });
    fake.reply({ requestId: fake.sent[1]?.requestId, ok: true, state: 'first' });
    expect((await first).state).toBe('first'); expect((await second).state).toBe('second'); expect(connect).toHaveBeenCalledTimes(1);
  });
  test('incompatible app never receives capture payload', async () => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port);
    const result = client.send({ type: 'add', cookies: 'secret' });
    fake.reply({ requestId: fake.sent[0]?.requestId, ok: true, protocolVersion: 1 });
    expect((await result).ok).toBe(false); expect(fake.sent).toHaveLength(1);
  });
  test('disconnect settles pending calls and reconnects on next request', async () => {
    const fake = fakePort(); const client = new NativeClient(() => fake.port, () => 'host disconnected');
    const result = client.hello(); fake.port.disconnect(); expect((await result).ok).toBe(false);
    const again = client.hello(); fake.reply({ requestId: fake.sent[1]?.requestId, ok: true, protocolVersion: 2, capabilities: ['capture-confirmation'] });
    expect((await again).ok).toBe(true);
  });
  test('timeout settles without logging or retaining credentials', async () => {
    vi.useFakeTimers(); const fake = fakePort(); const client = new NativeClient(() => fake.port);
    const result = client.hello(); await vi.advanceTimersByTimeAsync(5000); expect((await result).error).toBe('timeout'); vi.useRealTimers();
  });
});
describe('confirmation ownership', () => {
  test('accepted cancellation reply resolves a failed status race as accepted', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false, error: 'timeout' })
      .mockResolvedValueOnce({ ok: true, state: 'accepted', accepted: true });
    expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'id' }, send, async () => {})).toBe('accepted');
    expect(send).toHaveBeenLastCalledWith({ type: 'capture-cancel', captureId: 'id' }, 20_000);
  });
  test.each([
    { ok: false, error: 'native' }, { ok: true, state: 'browser' },
    { ok: true, state: 'accepted' }, { ok: true, accepted: true },
  ])('unconfirmed cancellation reply keeps browser ownership (%j)', async canceled => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false, error: 'timeout' }).mockResolvedValueOnce(canceled);
    expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'id' }, send, async () => {})).toBe('browser');
  });
  test('pending does not cancel; only successful confirmation accepts', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, state: 'pending' }).mockResolvedValueOnce({ ok: true, state: 'accepted', accepted: true });
    expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'id' }, send, async () => {})).toBe('accepted');
    expect(send).toHaveBeenCalledTimes(2);
  });
  test.each(['browser', 'rejected'])('app %s restores browser ownership', async state => {
    const send = vi.fn().mockResolvedValue({ ok: true, state });
    expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'id' }, send, async () => {})).toBe('browser');
    expect(send).toHaveBeenLastCalledWith({ type: 'capture-cancel', captureId: 'id' }, 20_000);
  });
  test('plain v1 ok is never enough to cancel', async () => {
    expect(await awaitAcceptance({ ok: true }, vi.fn())).toBe('browser');
  });
  test('five-minute expiry still holds the browser when cancellation explicitly cannot finish cleanup', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, state: 'pending', accepted: false });
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await awaitAcceptance({ ok: true, state: 'pending', captureId: 'id' }, send, wait)).toBe('attention');
    expect(wait).toHaveBeenCalledTimes(1200);
    expect(send).toHaveBeenCalledTimes(1201);
    expect(send).toHaveBeenLastCalledWith({ type: 'capture-cancel', captureId: 'id' }, 20_000);
  });
});
describe('observed browser requests', () => {
  const item = { id: 1, url: 'https://example.com/a.zip', finalUrl: 'https://cdn.example/a.zip' };
  const request = { requestId: '1', url: item.url, method: 'GET', tabId: 1, timeStamp: 1000 };
  test('real request headers, response metadata and redirects are carried', () => {
    const tracker = new RequestTracker(); tracker.observe({ ...request, redirectUrl: item.finalUrl });
    tracker.observe({ ...request, url: item.finalUrl, requestHeaders: [{ name: 'Authorization', value: 'Bearer test' }, { name: 'User-Agent', value: 'Real agent' }], responseHeaders: [{ name: 'Content-Type', value: 'application/zip' }, { name: 'Content-Length', value: '123' }, { name: 'Content-Disposition', value: 'attachment; filename=a.zip' }], statusCode: 200 });
    const observed = tracker.find(item, 1001)!;
    expect(observed.headers).toEqual({ Authorization: 'Bearer test' }); expect(observed.userAgent).toBe('Real agent'); expect(observed.size).toBe(123); expect(observed.redirects).toEqual([item.finalUrl]); expect(observed.responseStatus).toBe(200);
  });
  test('POST remains unsafe through a GET redirect', () => {
    const tracker = new RequestTracker(); tracker.observe({ ...request, method: 'POST', redirectUrl: item.finalUrl }); tracker.observe({ ...request, url: item.finalUrl });
    expect(tracker.find(item, 1001)?.method).toBe('POST');
  });
  test('ambiguous or expired request correlation is refused', () => {
    const tracker = new RequestTracker(); tracker.observe(request); tracker.observe({ ...request, requestId: '2' }); expect(tracker.find(item, 1001)).toBeUndefined(); expect(tracker.find(item, 62000)).toBeUndefined();
  });
  test('redirect clears credentials from the previous hop', () => {
    const tracker = new RequestTracker(); tracker.observe({ ...request, requestHeaders: [{ name: 'Authorization', value: 'secret' }] }); tracker.observe({ ...request, redirectUrl: item.finalUrl }); expect(tracker.find(item, 1001)?.headers).toEqual({});
  });
  test('header injection never reaches the native host', () => {
    const tracker = new RequestTracker(); tracker.observe({ ...request, requestHeaders: [{ name: 'Authorization', value: 'secret\r\nInjected: yes' }] }); expect(tracker.find({ id: item.id, url: item.url }, 1001)?.headers).toEqual({});
  });
});
test('settings validation and site exclusions are app-owned', () => {
  expect(settingsFromReply({ ok: true, captureExtensions: ['zip'], minSizeKiB: 0, excludedSites: ['site.com'], capturePrivate: true })?.capturePrivate).toBe(true);
  expect(settingsFromReply({ ok: true, captureExtensions: ['zip'], minSizeKiB: 0, excludedSites: ['x\ny'] })).toBeNull();
  expect(siteExcluded({ ...DEFAULT_SETTINGS, excludedSites: ['example.com'] }, ['https://example.com/page'])).toBe(true);
});
