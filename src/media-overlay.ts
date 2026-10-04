import { browser } from 'wxt/browser';
import tokens from '../assets/tokens.css?inline';
import { mediaCandidates } from './media-candidates';
import { text } from './ui';
import type { Settings } from './types';

export function discoverMedia(protectedElements?: WeakSet<HTMLMediaElement>): ReturnType<typeof mediaCandidates> {
  const candidates: { url: string; protected: boolean }[] = [];
  const elements = document.querySelectorAll<HTMLMediaElement>('video,audio');
  for (let i = 0; i < Math.min(elements.length, 64); i++) {
    const element = elements[i]!; const protectedMedia = !!element.mediaKeys || protectedElements?.has(element) === true;
    const urls = [element.currentSrc, element.src]; const sources = element.querySelectorAll<HTMLSourceElement>('source[src]');
    for (let j = 0; j < Math.min(sources.length, 8); j++) urls.push(sources[j]!.src);
    for (const url of urls) {
      if (candidates.length === 128) break;
      if (url) candidates.push({ url, protected: protectedMedia });
    }
    if (candidates.length === 128) break;
  }
  return mediaCandidates(candidates, location.href);
}
/** Appears only after the page menu command; no persistent opt-in or background discovery. */
export function openMediaOverlay(settings: Settings, session: string, protectedElements = new WeakSet<HTMLMediaElement>()): () => void {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;max-width:calc(100vw - 24px)';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  // Canonical token selectors apply to this shadow-local wrapper, leaving the page theme alone.
  style.textContent = tokens.replaceAll(':root', '.panel') + `
    .panel { font:14px/1.4 system-ui,sans-serif; color:var(--colibri-text); background:var(--colibri-surface); padding:16px; border:1px solid var(--colibri-divider); border-radius:12px; width:300px; max-width:calc(100vw - 56px); box-shadow:0 4px 24px #0004; }
    h2 {font-size:16px;margin:0 0 8px} p {margin:8px 0} .hint {font-size:12px} ul {padding:0;list-style:none;max-height:40vh;overflow:auto} li {margin:8px 0;overflow-wrap:anywhere} strong,small {display:block} button {font:inherit;padding:6px 10px;margin-top:6px;cursor:pointer;color:inherit;background:var(--colibri-chrome);border:1px solid var(--colibri-divider);border-radius:6px} button:focus-visible {outline:2px solid var(--colibri-accent);outline-offset:2px} button:disabled {opacity:.55;cursor:default}
  `;
  const panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.theme = settings.theme; panel.dataset.palette = settings.palette;
  panel.style.setProperty('--colibri-accent', settings.accent); panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', text('mediaTitle'));
  const title = document.createElement('h2'); title.textContent = text('mediaTitle');
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = text('mediaHint');
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul'); const close = document.createElement('button'); close.textContent = text('pickerClose');
  panel.append(title, hint, status, list, close); shadow.append(style, panel); document.documentElement.append(host);
  let timer: ReturnType<typeof setTimeout> | undefined; let busy = false; let closed = false; let lastSignature: string | undefined;
  const onProtected = (event: Event) => { if (event.target instanceof HTMLMediaElement) { protectedElements.add(event.target); render(); } };
  document.addEventListener('encrypted', onProtected, true); document.addEventListener('waitingforkey', onProtected, true);
  const observer = new MutationObserver(() => { if (!busy && !timer) timer = setTimeout(() => { timer = undefined; render(); }, 150); });
  const stopDiscovery = () => { observer.disconnect(); document.removeEventListener('encrypted', onProtected, true); document.removeEventListener('waitingforkey', onProtected, true); };
  const dispose = () => { if (closed) return; closed = true; stopDiscovery(); clearTimeout(timer); clearTimeout(expiry); host.remove(); void browser.runtime.sendMessage({ type: 'media-close', session }).catch(() => {}); };
  const expiry = setTimeout(() => { busy = true; stopDiscovery(); status.textContent = text('mediaExpired'); for (const button of list.querySelectorAll('button')) button.disabled = true; }, 120_000);
  function render(): void {
    if (closed || busy) return;
    // Keep focused controls stable if the bounded source snapshot is unchanged.
    const links = discoverMedia(protectedElements); const signature = links.map(link => link.url).join('\n');
    if (lastSignature === signature) return; lastSignature = signature; list.replaceChildren();
    status.textContent = links.length ? '' : text('mediaEmpty');
    for (const link of links) {
      const row = document.createElement('li'); const name = document.createElement('strong'); name.textContent = link.fileName;
      const detail = document.createElement('small'); detail.textContent = `${link.domain} · ${text(link.category === 'music' ? 'mediaAudio' : 'mediaVideo')} · ${text('pickerUnknownSize')}`;
      const button = document.createElement('button'); button.textContent = text('pickerSubmit');
      button.addEventListener('click', event => {
        if (!event.isTrusted || busy || !discoverMedia(protectedElements).some(candidate => candidate.url === link.url)) { render(); return; }
        busy = true; stopDiscovery(); clearTimeout(timer); clearTimeout(expiry);
        for (const control of list.querySelectorAll('button')) control.disabled = true;
        status.textContent = text('capturePending');
        void browser.runtime.sendMessage({ type: 'media-submit', session, url: link.url }).then(reply => {
          status.textContent = text(reply?.state === 'accepted' ? 'captureAccepted' : reply?.state === 'attention' ? 'captureAttention' : 'mediaFallback');
        }).catch(() => { status.textContent = text('mediaFallback'); });
      });
      row.append(name, detail, button); list.append(row);
    }
  }
  close.addEventListener('click', dispose); panel.addEventListener('keydown', event => { if (event.key === 'Escape') dispose(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'type'] });
  render(); close.focus(); return dispose;
}
