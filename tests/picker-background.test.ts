import { afterEach, expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const event = (name: string) => ({ addListener: (listener: (...args: unknown[]) => unknown) => { listeners.set(name, listener); } });
  let nativeMessage: (message: unknown) => void = () => {};
  const cookies = vi.fn(async () => []);
  const nativePosts = vi.fn((message: Record<string, unknown>) => {
    queueMicrotask(() => nativeMessage({ requestId: message.requestId, ok: false, error: 'app-not-running', protocolVersion: 2, capabilities: ['capture-confirmation', 'bulk-add'] }));
  });
  const tabUpdates = vi.fn(async (id: number, update: { url: string }) => {
    // Emulate a picker script requesting its data immediately as navigation starts.
    return listeners.get('message')?.({ type: 'picker-get', session: new URL(update.url).searchParams.get('session') }, { url: update.url, tab: { id } });
  });
  const browser = {
    runtime: { connectNative: () => ({ postMessage: nativePosts, onMessage: { addListener: (fn: typeof nativeMessage) => { nativeMessage = fn; } }, onDisconnect: event('disconnect') }),
      getURL: (path: string) => `chrome-extension://fixture${path}`, onInstalled: event('installed'), onMessage: event('message') },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    cookies: { getAllCookieStores: async () => [], getAll: cookies },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    webRequest: { onBeforeRequest: event('request'), onBeforeSendHeaders: event('headers'), onHeadersReceived: event('response'), onBeforeRedirect: event('redirect') },
    downloads: { onDeterminingFilename: event('filename'), pause: async () => {}, resume: async () => {}, cancel: async () => {} },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated'),
      sendMessage: async () => [{ url: 'https://files.example/a.zip?sig=fixture', pageUrl: 'https://frame.example/page', fileName: 'a.zip' }],
      create: async () => ({ id: 9 }), update: tabUpdates },
    contextMenus: { onClicked: event('menu') },
  };
  return { browser, listeners, cookies, nativePosts, tabUpdates };
});
vi.mock('wxt/browser', () => ({ browser: fixture.browser }));
import { startBackground } from '../src/background';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

test('collection attaches picker ownership before loading its scripts and never reads cookies or sends bulk', async () => {
  vi.useFakeTimers(); startBackground();
  fixture.listeners.get('menu')?.({ menuItemId: 'colibri-download-all', pageUrl: 'https://top.example/', frameId: 7 }, { id: 3, windowId: 1 });
  await vi.waitFor(() => expect(fixture.tabUpdates).toHaveBeenCalledTimes(1));
  const data = await fixture.tabUpdates.mock.results[0]!.value;
  expect(data).toMatchObject({ state: 'ready', links: [{ pageUrl: 'https://frame.example/page' }] });
  expect(fixture.cookies).not.toHaveBeenCalled();
  expect(fixture.nativePosts.mock.calls.map(([message]) => message.type)).not.toContain('bulk-add');
  const url = fixture.tabUpdates.mock.calls[0]![1].url;
  const session = new URL(url).searchParams.get('session');
  fixture.listeners.get('updated')?.(9, { url: 'chrome-extension://fixture/picker.html?session=other' });
  expect(await fixture.listeners.get('message')?.({ type: 'picker-get', session }, { url, tab: { id: 9 } })).toMatchObject({ state: 'expired', links: [] });
});
