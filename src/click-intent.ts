import { isCapturableUrl } from './capture';
import type { Settings } from './types';
interface Identity { tabId: number; frameId?: number; incognito?: boolean; url: string }
interface Intent extends Identity { at: number; alt: boolean; ctrl: boolean; shift: boolean }
/** A trusted initiating anchor click, not a tab-wide keyboard latch. Memory only. */
export class ClickIntents {
  private readonly intents: Intent[] = [];
  add(identity: Identity, keys: { alt?: boolean; ctrl?: boolean; shift?: boolean }, now: number): void {
    this.prune(now);
    if (!isCapturableUrl(identity.url) || identity.url.length > 8192) return;
    for (let i = this.intents.length - 1; i >= 0; i--) {
      const intent = this.intents[i]!;
      if (intent.tabId === identity.tabId && intent.frameId === identity.frameId &&
        (intent.incognito === true) === (identity.incognito === true) && intent.url === identity.url) this.intents.splice(i, 1);
    }
    this.intents.push({ ...identity, at: now, alt: keys.alt === true, ctrl: keys.ctrl === true, shift: keys.shift === true });
    if (this.intents.length > 128) this.intents.shift();
  }
  consume(identity: Identity, modifier: Settings['bypassModifier'], now: number): boolean {
    this.prune(now);
    const index = this.intents.findIndex(intent => intent.tabId === identity.tabId &&
      intent.frameId === identity.frameId && (intent.incognito === true) === (identity.incognito === true) && intent.url === identity.url);
    if (index < 0) return false;
    const [intent] = this.intents.splice(index, 1);
    return modifier !== 'none' && intent![modifier];
  }
  clearTab(tabId: number): void { for (let i = this.intents.length - 1; i >= 0; i--) if (this.intents[i]!.tabId === tabId) this.intents.splice(i, 1); }
  private prune(now: number): void { for (let i = this.intents.length - 1; i >= 0; i--) if (now - this.intents[i]!.at > 10_000) this.intents.splice(i, 1); }
}
