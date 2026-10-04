import { fileNameFromUrl, isCapturableUrl, isSafeHeaderValue } from './capture';
import { categoryForFileName } from './generated/capture-catalog';
export interface MediaCandidate { url: string; fileName: string; domain: string; category: 'music' | 'video' }
/** Filename hints only. No probes, manifest parsing or invented quality/size metadata. */
export function mediaCandidates(value: unknown, pageUrl: string): MediaCandidate[] {
  if (!Array.isArray(value) || !isCapturableUrl(pageUrl)) return [];
  const blocked = new Set<string>();
  for (const raw of value.slice(0, 128)) {
    if (raw?.protected === true && isCapturableUrl(raw.url)) { const url = new URL(raw.url); url.hash = ''; blocked.add(url.href); }
  }
  const result = new Map<string, MediaCandidate>();
  for (const raw of value.slice(0, 128)) {
    if (!raw || typeof raw !== 'object' || raw.protected === true || !isCapturableUrl(raw.url)) continue;
    const url = new URL(raw.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    url.hash = '';
    if (blocked.has(url.href)) continue;
    const fileName = fileNameFromUrl(url.href); const category = categoryForFileName(fileName);
    if (!isSafeHeaderValue(fileName) || fileName.length > 1024 || !['music', 'video'].includes(category)) continue;
    result.set(url.href, { url: url.href, fileName, domain: url.hostname, category: category as 'music' | 'video' });
    if (result.size === 20) break;
  }
  return [...result.values()];
}
interface Identity { tabId: number; frameId: number; privateWindow: boolean; pageUrl: string }
export class MediaSessions {
  private readonly sessions = new Map<string, Identity & { at: number; claimed?: boolean }>();
  prune(now: number): void { for (const [id, session] of this.sessions) if (now - session.at >= 120_000) this.sessions.delete(id); }
  create(identity: Identity, now: number): string | undefined {
    this.prune(now);
    if (!isCapturableUrl(identity.pageUrl) || this.sessions.size >= 32) return undefined;
    const id = crypto.randomUUID(); this.sessions.set(id, { ...identity, at: now }); return id;
  }
  consume(id: string, identity: Identity, now: number): boolean {
    this.prune(now); const session = this.sessions.get(id);
    if (!session || session.tabId !== identity.tabId || session.frameId !== identity.frameId ||
      session.privateWindow !== identity.privateWindow || session.pageUrl !== identity.pageUrl) return false;
    this.sessions.delete(id); return true;
  }
  begin(id: string, identity: Identity, now: number): (() => boolean) | undefined {
    this.prune(now); const session = this.sessions.get(id);
    if (!session || session.claimed || session.tabId !== identity.tabId || session.frameId !== identity.frameId ||
      session.privateWindow !== identity.privateWindow || session.pageUrl !== identity.pageUrl) return undefined;
    session.claimed = true;
    return () => this.sessions.get(id) === session && Date.now() - session.at < 120_000;
  }
  finish(id: string): void { this.sessions.delete(id); }
  clearTab(tabId: number): void { for (const [id, session] of this.sessions) if (session.tabId === tabId) this.sessions.delete(id); }
}
