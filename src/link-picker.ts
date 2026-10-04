import { baseName, buildAddMessage, extensionOf, fileNameFromUrl, isCapturableUrl, isSafeHeaderValue, linkReferrer } from './capture';
import { awaitAcceptance } from './handoff';
import { siteExcluded } from './settings';
import type { HostReply, Settings } from './types';

export const MAX_LINKS = 500;
export const MAX_SELECTED = 100;
export const PICKER_TTL = 5 * 60_000;
export interface PickerLink { id: string; url: string; pageUrl: string; fileName: string; domain: string; extension: string }
export type PickerState = 'ready' | 'pending' | 'accepted' | 'browser' | 'attention' | 'expired' | 'invalid' | 'excluded' | 'private' | 'incompatible';
export interface PickerResult { state: PickerState }

/** Untrusted content-script results: exact network URL deduplication, no query rewriting. */
export function normalizeLinks(value: unknown): PickerLink[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, PickerLink>();
  for (const raw of value.slice(0, 5000)) {
    if (!raw || typeof raw !== 'object' || !isCapturableUrl(raw.url) || !isCapturableUrl(raw.pageUrl)) continue;
    const url = new URL(raw.url);
    if (url.username || url.password) continue;
    url.hash = '';
    if (unique.has(url.href)) continue;
    const suggested = typeof raw.fileName === 'string' ? baseName(raw.fileName) : '';
    const fileName = (suggested || fileNameFromUrl(url.href)).slice(0, 1024);
    if (!isSafeHeaderValue(fileName)) continue;
    unique.set(url.href, { id: String(unique.size), url: url.href, pageUrl: raw.pageUrl,
      fileName, domain: url.hostname, extension: extensionOf(fileName).slice(0, 16) });
    if (unique.size === MAX_LINKS) break;
  }
  return [...unique.values()];
}
export function visibleLinks(links: PickerLink[], query: string): PickerLink[] {
  const term = query.trim().toLowerCase();
  // Queries and page URLs are deliberately absent from search/display text.
  return links.filter(link => `${link.fileName} ${link.domain} ${link.extension}`.toLowerCase().includes(term));
}
export function selectVisible(selected: Set<string>, links: PickerLink[], checked: boolean): void {
  for (const link of links) {
    if (!checked) selected.delete(link.id);
    else if (selected.size < MAX_SELECTED) selected.add(link.id);
  }
}
interface Session {
  links: PickerLink[]; privateWindow: boolean; at: number; tabId?: number;
  state: PickerState; flight?: Promise<PickerResult>;
  closed?: boolean;
}
interface Dependencies {
  now(): number; settings(): Promise<Settings>; hello(): Promise<HostReply>;
  cookies(url: string, privateWindow: boolean): Promise<string>;
  send(message: Record<string, unknown>, timeoutMs?: number): Promise<HostReply>;
  wait?(ms: number): Promise<void>;
}
/** Volatile, tab-owned selections. No persistence and no download cancellation authority. */
export class PickerSessions {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly deps: Dependencies) {}
  prune(): void {
    for (const [id, session] of this.sessions) {
      if (!session.flight && this.deps.now() - session.at >= PICKER_TTL) this.sessions.delete(id);
    }
  }
  create(links: PickerLink[], privateWindow: boolean): string | undefined {
    this.prune();
    if (this.sessions.size >= 8) return undefined;
    const id = crypto.randomUUID();
    this.sessions.set(id, { links, privateWindow, at: this.deps.now(), state: 'ready' });
    return id;
  }
  attach(id: string, tabId: number): void { const session = this.sessions.get(id); if (session) session.tabId = tabId; }
  remove(id: string): void {
    const session = this.sessions.get(id);
    if (session) { session.closed = true; session.links = []; }
    this.sessions.delete(id);
  }
  closeTab(tabId: number): void {
    for (const [id, session] of this.sessions) if (session.tabId === tabId) this.remove(id);
  }
  get(id: string, tabId: number): Session | undefined {
    this.prune();
    const session = this.sessions.get(id);
    return session?.tabId === tabId ? session : undefined;
  }
  async submit(id: string, tabId: number, ids: unknown): Promise<PickerResult> {
    const session = this.get(id, tabId);
    if (!session) return { state: 'expired' };
    if (session.flight) return session.flight;
    if (session.state !== 'ready') return { state: session.state };
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SELECTED ||
      !ids.every(value => typeof value === 'string') || new Set(ids).size !== ids.length) return { state: 'invalid' };
    const links = ids.map(id => session.links.find(link => link.id === id));
    if (links.some(link => !link)) return { state: 'invalid' };
    const flight = this.offer(session, links as PickerLink[]);
    session.flight = flight;
    try { return await flight; } finally { session.flight = undefined; }
  }
  private async offer(session: Session, links: PickerLink[]): Promise<PickerResult> {
    let submitted = false;
    try {
      const hello = await this.deps.hello();
      if (session.closed || this.deps.now() - session.at >= PICKER_TTL) return { state: 'expired' };
      if (hello.protocolVersion !== 2 || !hello.capabilities?.includes('capture-confirmation') ||
        !hello.capabilities.includes('bulk-add') || (!hello.ok && hello.error !== 'app-not-running')) return { state: 'incompatible' };
      const settings = await this.deps.settings();
      if (session.closed || this.deps.now() - session.at >= PICKER_TTL) return { state: 'expired' };
      if (session.privateWindow && !settings.capturePrivate) return { state: 'private' };
      if (links.some(link => siteExcluded(settings, [link.url, link.pageUrl], link.fileName))) return { state: 'excluded' };
      const contexts = [];
      for (const link of links) {
        if (session.closed || this.deps.now() - session.at >= PICKER_TTL) return { state: 'expired' };
        const message = buildAddMessage({ url: link.url, fileName: link.fileName,
          referrer: linkReferrer(link.pageUrl, link.url),
          cookies: await this.deps.cookies(link.url, session.privateWindow) });
        if (!message) return { state: 'invalid' };
        message.privateWindow = session.privateWindow;
        const { type: _, ...context } = message; void _; contexts.push(context);
      }
      if (session.closed || this.deps.now() - session.at >= PICKER_TTL) return { state: 'expired' };
      // Reserve room for the native envelope; do not split into automatic multiple offers.
      if (new TextEncoder().encode(JSON.stringify(contexts)).length > 900_000) return { state: 'invalid' };
      submitted = true; session.state = 'pending';
      session.state = await awaitAcceptance(await this.deps.send({ type: 'bulk-add', links: contexts }), this.deps.send, this.deps.wait);
      return { state: session.state };
    } catch {
      if (submitted) session.state = 'browser';
      return { state: submitted ? 'browser' : 'incompatible' };
    } finally {
      if (submitted) session.links = [];
    }
  }
}
