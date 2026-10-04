import { buildAddMessage, cookiesAllowed, decideCapture, downloadFileName, knownSize } from './capture';
import { siteExcluded } from './settings';
import type { CaptureRecord, DownloadItem, HostReply, Settings } from './types';
import type { ObservedRequest } from './request-context';
import { sanitizeExplanation, type CaptureExplanation } from './capture-explanation';

export interface HandoffDependencies {
  settings(): Promise<Settings>;
  observe(item: DownloadItem): ObservedRequest | undefined;
  bypass(tabId: number, modifier: Settings['bypassModifier'], request?: ObservedRequest): boolean;
  cookies(url: string, privateWindow: boolean): Promise<string>;
  send(message: Record<string, unknown>, timeoutMs?: number): Promise<HostReply>;
  pause(id: number): Promise<void>; resume(id: number): Promise<void>;
  cancel(id: number): Promise<void>; erase(id: number): Promise<void>;
  record(record: CaptureRecord): Promise<void>;
  explain?(summary: CaptureExplanation): void;
  requireObservation?: boolean;
  wait?(ms: number): Promise<void>;
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export type CaptureOutcome = 'accepted' | 'browser' | 'attention';

export async function awaitAcceptance(reply: HostReply, send: HandoffDependencies['send'], wait = delay): Promise<CaptureOutcome> {
  if (reply.ok !== true) return 'browser';
  if (reply.state === 'accepted' && reply.accepted === true) return 'accepted';
  if (reply.state !== 'pending' || typeof reply.captureId !== 'string' || !reply.captureId) return 'browser';
  const captureId = reply.captureId;
  // Five minutes to decide; a single native request retains its normal 20 second timeout.
  for (let attempt = 0; attempt < 1200; attempt++) {
    await wait(250);
    reply = await send({ type: 'capture-status', captureId });
    if (reply.captureId !== undefined && reply.captureId !== captureId) break;
    if (reply.ok === true && reply.state === 'accepted' && reply.accepted === true) return 'accepted';
    if (reply.ok !== true || reply.state !== 'pending') break;
  }
  // Acceptance may win while the status request is failing or expiring.
  // Cancellation returns the authoritative terminal state instead of undoing acceptance.
  const canceled = await send({ type: 'capture-cancel', captureId }, 20_000);
  if (canceled.ok !== true || (canceled.captureId !== undefined && canceled.captureId !== captureId)) return 'browser';
  if (canceled.state === 'accepted' && canceled.accepted === true) return 'accepted';
  // The app cannot yet release ownership: resuming now could start a second transfer.
  // This hold requires an explicit correlated reply, never a transport error or unknown state.
  if (canceled.state === 'pending' && (canceled.accepted === false || canceled.accepted === undefined)) return 'attention';
  return 'browser';
}

/** Deduplicates concurrent events for one browser download, not cross-restart ownership. */
export class HandoffCoordinator {
  private readonly flights = new Map<number, Promise<void>>();
  run(item: DownloadItem, deps: HandoffDependencies, release: () => void = () => {}): Promise<void> {
    const existing = this.flights.get(item.id);
    if (existing) return existing.finally(release);
    let released = false;
    const once = () => { if (!released) { released = true; release(); } };
    const flight = Promise.resolve().then(() => handoff(item, deps, once)).finally(() => { this.flights.delete(item.id); once(); });
    this.flights.set(item.id, flight);
    return flight;
  }
}

/** Uncertain failures release the browser; confirmed pending cleanup leaves it paused for review. */
export async function handoff(item: DownloadItem, deps: HandoffDependencies, release: () => void = () => {}): Promise<void> {
  let paused = false;
  let outcome: CaptureOutcome = 'browser';
  let offered = false;
  const fileName = downloadFileName(item);
  const explain = (summary: CaptureExplanation) => {
    if (item.incognito) return;
    try { deps.explain?.(summary); } catch { /* Explanations cannot affect ownership. */ }
  };
  let desktopReason: CaptureExplanation['reason'];
  try {
    const settings = await deps.settings();
    const request = deps.observe(item);
    const decisionItem = { ...item, incognito: item.incognito && !settings.capturePrivate };
    const decision = decideCapture({ enabled: settings.enabled, rules: settings, item: decisionItem });
    if (!decision.capture) { explain({ kind: 'policy', ...sanitizeExplanation({ kind: 'policy', reason: decision.reason }), outcome: 'browser' }); return; }
    if (siteExcluded(settings, [item.url, item.finalUrl, item.referrer, request?.referrer], fileName)) {
      explain({ kind: 'policy', reason: 'excluded', outcome: 'browser' }); return;
    }
    if ((deps.requireObservation && !request) || (request && request.method !== 'GET')) {
      explain({ kind: 'association', ...(request ? { reason: 'method' as const } : {}), outcome: 'browser' }); return;
    }
    if (request && deps.bypass(request.tabId, settings.bypassModifier, request)) { explain({ kind: 'bypass', outcome: 'browser' }); return; }
    const message = buildAddMessage({ url: item.url, finalUrl: item.finalUrl, fileName,
      referrer: request?.referrer ?? item.referrer,
      cookies: cookiesAllowed(item.url, item.finalUrl) ? await deps.cookies(item.url, item.incognito === true) : '',
      userAgent: request?.userAgent, size: request?.size ?? knownSize(item), mimeType: request?.mimeType ?? item.mime,
    });
    if (!message) { explain({ kind: 'policy', reason: 'safety', outcome: 'browser' }); return; }
    message.captureAction = decision.action ?? "ask";
    message.privateWindow = item.incognito === true;
    if (request) Object.assign(message, { headers: request.headers, redirects: request.redirects,
      contentDisposition: request.contentDisposition, responseStatus: request.responseStatus, requestMethod: 'GET' });
    await deps.pause(item.id); paused = true;
    if (!item.incognito) await deps.record({ fileName, state: 'pending', at: Date.now() });
    offered = true; explain({ kind: 'handoff', outcome: 'pending' });
    const reply = await deps.send({ ...message });
    desktopReason = sanitizeExplanation({ kind: 'policy', reason: reply.decisionReason })?.reason;
    outcome = await awaitAcceptance(reply, deps.send, deps.wait);
    if (outcome === 'accepted') {
      await deps.cancel(item.id); paused = false;
      release();
      await deps.erase(item.id);
    }
  } catch { outcome = 'browser'; }
  finally {
    if (paused && outcome !== 'attention') try { await deps.resume(item.id); } catch { /* Browser item already gone. */ }
    release();
    if (offered) {
      explain({ kind: 'handoff', ...(desktopReason ? { reason: desktopReason } : {}), outcome });
      if (!item.incognito) try { await deps.record({ fileName, state: outcome, at: Date.now() }); } catch { /* No credential data is persisted. */ }
    }
  }
}
