import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { collectPageLinks } from '../src/page-links';
import { openMediaOverlay } from '../src/media-overlay';
import type { Settings } from '../src/types';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: true, runAt: 'document_start',
  main(ctx) {
    let closeOverlay: (() => void) | undefined;
    const protectedMedia = new WeakSet<HTMLMediaElement>();
    const markProtected = (event: Event) => { if (event.target instanceof HTMLMediaElement) protectedMedia.add(event.target); };
    ctx.addEventListener(document, 'encrypted', markProtected, { capture: true });
    ctx.addEventListener(document, 'waitingforkey', markProtected, { capture: true });
    ctx.addEventListener(window, 'wxt:locationchange', () => { closeOverlay?.(); });
    ctx.addEventListener(window, 'pagehide', () => { closeOverlay?.(); });
    ctx.onInvalidated(() => { closeOverlay?.(); });
    // Passive observation only; page requests and click behavior are never modified.
    document.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
      if (!anchor?.href) return;
      const url = new URL(anchor.href); url.hash = '';
      void browser.runtime.sendMessage({ type: 'modifier', url: url.href, alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey }).catch(() => {});
    }, true);
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if (message.type === 'show-media' && 'session' in message && typeof message.session === 'string' && 'settings' in message) {
        closeOverlay?.(); closeOverlay = openMediaOverlay(message.settings as Settings, message.session, protectedMedia); return Promise.resolve({ ok: true });
      }
      if (message.type !== 'collect-links') return;
      const selected = 'selected' in message && message.selected === true;
      const selection = window.getSelection();
      return Promise.resolve(collectPageLinks(document.querySelectorAll<HTMLAnchorElement>('a[href]'), location.href, anchor => {
        if (!selected) return true;
        if (!selection) return false;
        for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(anchor)) return true;
        return false;
      }));
    });
  },
});
