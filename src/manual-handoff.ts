import { buildAddMessage, fileNameFromUrl, isCapturableUrl, linkReferrer } from './capture';
import { awaitAcceptance, type CaptureOutcome } from './handoff';
import { siteExcluded } from './settings';
import type { HostReply, Settings } from './types';
export interface ManualDependencies {
  hello(): Promise<HostReply>; settings(): Promise<Settings>;
  cookies(url: string, privateWindow: boolean): Promise<string>;
  send(message: Record<string, unknown>, timeoutMs?: number, valid?: () => boolean): Promise<HostReply>;
  valid?(): boolean;
}
/** Deliberate GET link intent overrides automatic preferences, never safety/exclusions. */
export async function manualHandoff(url: string, pageUrl: string, privateWindow: boolean, deps: ManualDependencies): Promise<CaptureOutcome | 'excluded' | 'private' | 'invalid' | 'incompatible' | 'expired'> {
  try {
    if (!isCapturableUrl(url)) return 'invalid';
    const hello = await deps.hello();
    if (deps.valid?.() === false) return 'expired';
    if (hello.protocolVersion !== 2 || !hello.capabilities?.includes('capture-confirmation') || (!hello.ok && hello.error !== 'app-not-running')) return 'incompatible';
    const settings = await deps.settings();
    if (deps.valid?.() === false) return 'expired';
    if (privateWindow && !settings.capturePrivate) return 'private';
    const fileName = fileNameFromUrl(url);
    if (siteExcluded(settings, [url, pageUrl], fileName)) return 'excluded';
    const message = buildAddMessage({ url, fileName, referrer: linkReferrer(pageUrl, url), cookies: await deps.cookies(url, privateWindow) });
    if (deps.valid?.() === false) return 'expired';
    if (!message) return 'invalid';
    message.privateWindow = privateWindow;
    const reply = deps.valid ? await deps.send({ ...message }, undefined, deps.valid) : await deps.send({ ...message });
    return await awaitAcceptance(reply, deps.send);
  } catch { return 'incompatible'; }
}
