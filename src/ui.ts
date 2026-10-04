import { browser } from 'wxt/browser';
import messages from '../public/_locales/en/messages.json';
import type { Settings } from './types';
export type MessageKey = keyof typeof messages;
export function text(key: MessageKey, substitutions?: string[]): string {
  const localized = browser.i18n.getMessage(key, substitutions);
  if (localized) return localized;
  const fallback = messages[key] as { message: string; placeholders?: Record<string, { content: string }> };
  return fallback.message.replace(/\$([a-z_]+)\$/gi, (literal, name: string) => {
    const content = fallback.placeholders?.[name.toLowerCase()]?.content;
    const index = content && /^\$(\d+)$/.exec(content);
    return index ? substitutions?.[Number(index[1]) - 1] ?? '' : literal;
  });
}
export function localize(): void {
  document.title = text('extName');
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    if (key && key in messages) element.textContent = text(key as MessageKey);
  });
}
const statusKeys: Record<string, MessageKey> = { connected: 'popupStatusConnected', notRunning: 'popupStatusNotRunning', hostMissing: 'popupStatusHostMissing', incompatible: 'popupProtocolError', error: 'popupStatusError' };
export function showStatus(status: string): void {
  const element = document.getElementById('status');
  if (element) { element.textContent = text(statusKeys[status] ?? 'popupStatusError'); element.dataset.connection = status; }
}
export function applyTheme(settings: Settings): void {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.palette = settings.palette;
  document.documentElement.style.setProperty('--colibri-accent', settings.accent);
}
