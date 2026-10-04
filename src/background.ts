import { browser } from 'wxt/browser';
import { connectionStatus, cookieHeader } from './capture';
import { NativeClient } from './native';
import { RequestTracker } from './request-context';
import { DEFAULT_SETTINGS, settingsFromReply } from './settings';
import { HandoffCoordinator } from './handoff';
import { manualHandoff } from './manual-handoff';
import { mediaCandidates, MediaSessions } from './media-candidates';
import { normalizeLinks, PickerSessions } from './link-picker';
import { sanitizeExplanation, type CaptureExplanation } from './capture-explanation';
import { ClickIntents } from './click-intent';
import type { CaptureRecord, HostReply, Settings } from './types';

export function startBackground(): void {
  const native = new NativeClient(() => browser.runtime.connectNative('com.colibri.host'),
    () => browser.runtime.lastError?.message ?? '');
  const requests = new RequestTracker();
  const intents = new ClickIntents();
  const handoffs = new HandoffCoordinator();
  const media = new MediaSessions();
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let loaded = false;
  let lastConnection: HostReply = { ok: false };
  let lastExplanation: CaptureExplanation | undefined;
  const load = async () => {
    if (!loaded) {
      const stored = await browser.storage.local.get('settings');
      if (stored.settings && typeof stored.settings === 'object') {
        const cached = stored.settings as Settings;
        settings = settingsFromReply({ ok: true, ...cached, captureExtensions: cached.extensions }) ?? settings;
      }
      loaded = true;
    }
    return settings;
  };
  const acceptSettings = async (reply: HostReply) => {
    const next = settingsFromReply(reply);
    if (next) { settings = next; loaded = true; await browser.storage.local.set({ settings }); }
  };
  native.onSettings = reply => { void acceptSettings(reply); };
  const refresh = async () => {
    await load();
    lastConnection = await native.hello();
    if (lastConnection.ok) {
      lastConnection = await native.send({ type: 'ping' }, 5000);
      if (lastConnection.ok) await acceptSettings(await native.send({ type: 'config' }));
    }
    return lastConnection;
  };
  void refresh().catch(() => {});
  // The app owns the rules. A polling fallback also works with request/reply-only native hosts.
  setInterval(() => { pickers.prune(); media.prune(Date.now()); void refresh().catch(() => {}); }, 30_000);
  const cookiesFor = async (url: string, privateWindow = false) => {
    // Private browsing cookies must use their own store, never the normal cookie jar.
    const stores = await browser.cookies.getAllCookieStores();
    const store = privateWindow ? stores.find(s => s.id === 'firefox-private' || s.id === '1') : undefined;
    if (privateWindow && !store) return '';
    return cookieHeader(await browser.cookies.getAll({ url, ...(store ? { storeId: store.id } : {}) }));
  };
  const authoritativeSettings = async () => {
      let connection = await refresh();
      // Submission is deliberate: launch a closed app to obtain current authoritative exclusions.
      if (connection.error === 'app-not-running') {
        await native.send({ type: 'open' }); connection = await refresh();
      }
      if (!connection.ok) throw new Error('Configuration unavailable');
      const reply = await native.send({ type: 'config' });
      const current = settingsFromReply(reply);
      if (!current) throw new Error('Configuration unavailable');
      await acceptSettings(reply); return current;
  };
  const manual = { cookies: cookiesFor, hello: native.hello.bind(native), send: native.send.bind(native), settings: authoritativeSettings };
  const pickers = new PickerSessions({ now: Date.now, ...manual });
  const pickerUrl = browser.runtime.getURL('/picker.html');
  browser.tabs.onRemoved.addListener(tabId => { pickers.closeTab(tabId); requests.clearTab(tabId); intents.clearTab(tabId); media.clearTab(tabId); });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) {
      requests.clearTab(tabId); intents.clearTab(tabId);
      media.clearTab(tabId);
      const id = new URL(change.url).searchParams.get('session');
      if (!id || change.url !== `${pickerUrl}?session=${id}` || !pickers.get(id, tabId)) pickers.closeTab(tabId);
    }
  });
  const record = async (entry: CaptureRecord) => {
    const stored = await browser.storage.local.get('recent');
    const recent = Array.isArray(stored.recent) ? stored.recent as CaptureRecord[] : [];
    // Filename and result only, no URLs, cookies, or request headers in the popup history.
    await browser.storage.local.set({ recent: [entry, ...recent].slice(0, 8) });
    if (entry.state === 'attention') {
      await browser.action.setBadgeBackgroundColor({ color: '#C75B5B' });
      await browser.action.setBadgeText({ text: '!' });
    }
  };
  const deps = { settings: load, observe: (item: Parameters<RequestTracker['find']>[0]) => requests.find(item),
    bypass: (_tabId: number, modifier: Settings['bypassModifier'], request?: ReturnType<RequestTracker['find']>) =>
      !!request && intents.consume(request, modifier, Date.now()),
    cookies: cookiesFor, send: native.send.bind(native), pause: browser.downloads.pause,
    resume: browser.downloads.resume, cancel: browser.downloads.cancel,
    erase: async (id: number) => {
      for (let attempt = 0; attempt < 25; attempt++) {
        const [item] = await browser.downloads.search({ id });
        if (!item || item.state !== 'in_progress') break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await browser.downloads.erase({ id });
    }, record, explain: (summary: CaptureExplanation) => { lastExplanation = sanitizeExplanation(summary); }, requireObservation: true,
  };
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  browser.webRequest.onBeforeRequest.addListener(details => { requests.observe(details); return undefined; }, filter);
  browser.webRequest.onBeforeSendHeaders.addListener(details => { requests.observe(details); return undefined; }, filter,
    import.meta.env.BROWSER === 'firefox' ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders']);
  browser.webRequest.onHeadersReceived.addListener(details => { requests.observe(details); return undefined; }, filter, ['responseHeaders']);
  browser.webRequest.onBeforeRedirect.addListener(details => { requests.observe(details); return undefined; }, filter, ['responseHeaders']);

  if (import.meta.env.BROWSER !== 'firefox') {
    browser.downloads.onDeterminingFilename.addListener((item, suggest) => {
      let released = false;
      void handoffs.run(item, deps, () => { if (!released) { released = true; suggest(); } })
        .finally(() => requests.forget(item));
      return true;
    });
  } else {
    // Firefox does not implement onDeterminingFilename. onCreated already exposes filename and metadata.
    browser.downloads.onCreated.addListener(item => { void handoffs.run(item, deps).finally(() => requests.forget(item)); });
  }
  const fail = async () => {
    await browser.action.setBadgeBackgroundColor({ color: '#C75B5B' });
    await browser.action.setBadgeText({ text: '!' });
    setTimeout(() => { void browser.action.setBadgeText({ text: '' }); }, 5000);
  };
  browser.runtime.onInstalled.addListener(details => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({ id: 'colibri-download-link', title: browser.i18n.getMessage('contextMenuDownload'), contexts: ['link'], targetUrlPatterns: ['http://*/*', 'https://*/*', 'ftp://*/*'] });
      browser.contextMenus.create({ id: 'colibri-download-media', title: browser.i18n.getMessage('contextMenuMedia'), contexts: ['image', 'video', 'audio'] });
      browser.contextMenus.create({ id: 'colibri-download-all', title: browser.i18n.getMessage('contextMenuAll'), contexts: ['page'] });
      browser.contextMenus.create({ id: 'colibri-download-selected', title: browser.i18n.getMessage('contextMenuSelected'), contexts: ['selection'] });
      browser.contextMenus.create({ id: 'colibri-page-media', title: browser.i18n.getMessage('contextMenuPageMedia'), contexts: ['page', 'video', 'audio'] });
    });
    if (details.reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    void (async () => {
      await load();
      if (info.menuItemId === 'colibri-page-media') {
        if (tab?.id === undefined) return;
        const current = await authoritativeSettings();
        if (tab.incognito && !current.capturePrivate) { await fail(); return; }
        const session = media.create({ tabId: tab.id, frameId: info.frameId ?? 0, privateWindow: tab.incognito === true, pageUrl: info.frameUrl ?? info.pageUrl ?? '' }, Date.now());
        if (!session) { await fail(); return; }
        await browser.tabs.sendMessage(tab.id, { type: 'show-media', session, settings: current }, { frameId: info.frameId ?? 0 });
        return;
      }
      if (tab?.incognito && !settings.capturePrivate) { await fail(); return; }
      if (info.menuItemId === 'colibri-download-all' || info.menuItemId === 'colibri-download-selected') {
        if (tab?.id === undefined) return;
        const links: unknown = await browser.tabs.sendMessage(tab.id, { type: 'collect-links', selected: info.menuItemId === 'colibri-download-selected' }, { frameId: info.frameId ?? 0 });
        if (!Array.isArray(links)) return;
        const id = pickers.create(normalizeLinks(links), tab.incognito === true);
        if (!id) { await fail(); return; }
        try {
          // Attach ownership before loading scripts; a fast picker cannot outrun tabs.create.
          const picker = await browser.tabs.create({ url: 'about:blank', windowId: tab.windowId });
          if (picker.id === undefined) { pickers.remove(id); return; }
          pickers.attach(id, picker.id);
          await browser.tabs.update(picker.id, { url: `${pickerUrl}?session=${id}` });
        } catch { pickers.remove(id); await fail(); }
        return;
      }
      const url = info.menuItemId === 'colibri-download-media' ? info.srcUrl : info.linkUrl;
      if (!url || await manualHandoff(url, info.frameUrl ?? info.pageUrl ?? '', tab?.incognito === true, manual) !== 'accepted') await fail();
    })().catch(() => { void fail(); });
  });
  browser.runtime.onMessage.addListener((value: unknown, sender) => {
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const message = value as Record<string, unknown>;
    if ((message.type === 'media-submit' || message.type === 'media-close') && sender.tab?.id !== undefined && typeof message.session === 'string') {
      const identity = { tabId: sender.tab.id, frameId: sender.frameId ?? 0, privateWindow: sender.tab.incognito === true, pageUrl: sender.url ?? '' };
      if (message.type === 'media-close') return Promise.resolve({ state: media.consume(message.session, identity, Date.now()) ? 'closed' : 'expired' });
      const session = message.session;
      const valid = media.begin(session, identity, Date.now());
      if (!valid) return Promise.resolve({ state: 'expired' });
      const candidate = mediaCandidates([{ url: message.url }], identity.pageUrl)[0];
      if (!candidate) { media.finish(session); return Promise.resolve({ state: 'invalid' }); }
      return manualHandoff(candidate.url, identity.pageUrl, identity.privateWindow, { ...manual, valid }).then(state => ({ state })).finally(() => { media.finish(session); });
    }
    if (typeof sender.url === 'string' && sender.url.split('?')[0] === pickerUrl && sender.tab?.id !== undefined &&
      typeof message.session === 'string') {
      if (message.type === 'picker-get') return load().then(current => {
        const session = pickers.get(message.session as string, sender.tab!.id!);
        return { state: session?.state ?? 'expired', links: session?.links ?? [], settings: current };
      });
      if (message.type === 'picker-submit') return pickers.submit(message.session, sender.tab.id, message.ids);
    }
    if (message.type === 'modifier' && sender.tab?.id !== undefined && typeof message.url === 'string') {
      intents.add({ tabId: sender.tab.id, frameId: sender.frameId, incognito: sender.tab.incognito, url: message.url },
        { alt: message.alt === true, ctrl: message.ctrl === true, shift: message.shift === true }, Date.now());
      return Promise.resolve({ ok: true });
    }
    // Pages cannot alter app-owned settings or open Colibri through the content-script bridge.
    if (sender.tab) return;
    if (message.type === 'popup-status') return refresh().then(async reply => ({ status: connectionStatus(reply), settings,
      explanation: lastExplanation, recent: (await browser.storage.local.get('recent')).recent ?? [] }));
    if (message.type === 'open') return native.send({ type: 'open' });
    if (message.type === 'settings-update' && message.patch && typeof message.patch === 'object') {
      return native.send({ type: 'settings-update', patch: message.patch }).then(async reply => { if (reply.ok) await acceptSettings(reply); return reply; });
    }
  });
}
