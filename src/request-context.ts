import { isCapturableUrl, isSafeHeaderValue } from './capture';
import type { AddContext, DownloadItem } from './types';

interface Header { name: string; value?: string }
interface Request {
  requestId: string; url: string; method: string; tabId: number; timeStamp: number;
  requestHeaders?: Header[]; responseHeaders?: Header[]; statusCode?: number; redirectUrl?: string; frameId?: number; incognito?: boolean;
}
export interface ObservedRequest extends AddContext { tabId: number; at: number; method: string; frameId?: number; incognito?: boolean }
const MAX_REQUESTS = 256;
const TTL = 60_000;

/** Short-lived memory only; never writes browsing URLs, cookies, or headers to storage. */
export class RequestTracker {
  private readonly requests = new Map<string, ObservedRequest>();
  observe(details: Request): void {
    this.prune(details.timeStamp);
    const key = `${details.incognito === true}:${details.requestId}`;
    let request = this.requests.get(key);
    if (!request) {
      request = { url: details.url, finalUrl: details.url, redirects: [], headers: {},
        tabId: details.tabId, frameId: details.frameId, incognito: details.incognito === true,
        at: details.timeStamp, method: details.method, requestMethod: details.method };
      this.requests.set(key, request);
    }
    if (request.finalUrl !== details.url) this.clearHop(request);
    request.finalUrl = details.url; request.at = details.timeStamp;
    // Preserve an unsafe original method even if a 303 redirect changes it to GET.
    if (details.method !== 'GET') request.method = details.method;
    request.requestMethod = request.method;
    if (details.requestHeaders) {
      request.referrer = undefined; request.userAgent = undefined;
      const headers: Record<string, string> = {};
      for (const header of details.requestHeaders) {
        if (!/^[!#$%&'*+.^_`|~a-z\d-]+$/i.test(header.name) || !isSafeHeaderValue(header.value) || header.value.length > 8192) continue;
        const name = header.name.toLowerCase();
        if (name === 'referer') request.referrer = header.value;
        else if (name === 'user-agent') request.userAgent = header.value;
        else if (!['cookie', 'host', 'content-length', 'connection', 'range', 'accept-encoding'].includes(name) && !name.startsWith('proxy-') && Object.keys(headers).length < 64) headers[header.name] = header.value;
      }
      request.headers = headers;
    }
    if (details.responseHeaders) {
      request.mimeType = undefined; request.contentDisposition = undefined; request.size = undefined;
      for (const header of details.responseHeaders) {
        if (!isSafeHeaderValue(header.value)) continue;
        if (header.name.toLowerCase() === 'content-type') request.mimeType = header.value.slice(0, 255);
        if (header.name.toLowerCase() === 'content-disposition') request.contentDisposition = header.value.slice(0, 4096);
        if (header.name.toLowerCase() === 'content-length' && /^\d+$/.test(header.value)) {
          const size = Number(header.value); if (Number.isSafeInteger(size)) request.size = size;
        }
      }
      request.responseStatus = details.statusCode;
    }
    if (details.redirectUrl && isCapturableUrl(details.redirectUrl)) {
      if ((request.redirects?.length ?? 0) < 20) request.redirects?.push(details.redirectUrl);
      request.finalUrl = details.redirectUrl;
      this.clearHop(request);
    }
    while (this.requests.size > MAX_REQUESTS) this.requests.delete(this.requests.keys().next().value!);
  }
  find(item: DownloadItem, now = Date.now()): ObservedRequest | undefined {
    this.prune(now);
    const matches = [...this.requests.values()].filter(request => this.matches(request, item));
    // Browser download ids and webRequest ids have no official mapping. Ambiguous requests stay in the browser.
    if (matches.length !== 1) return undefined;
    return matches[0];
  }
  forget(item: DownloadItem): void {
    for (const [id, request] of this.requests) if (this.matches(request, item)) this.requests.delete(id);
  }
  clearTab(tabId: number): void { for (const [id, request] of this.requests) if (request.tabId === tabId) this.requests.delete(id); }
  private matches(request: ObservedRequest, item: DownloadItem): boolean {
    return (request.incognito === true) === (item.incognito === true) &&
      (item.finalUrl ? request.finalUrl === item.finalUrl && (request.url === item.url || request.finalUrl === item.url) : request.url === item.url || request.finalUrl === item.url);
  }
  private clearHop(request: ObservedRequest): void {
    request.headers = {}; request.referrer = undefined; request.userAgent = undefined;
    request.mimeType = undefined; request.contentDisposition = undefined; request.size = undefined; request.responseStatus = undefined;
  }
  private prune(now: number): void {
    for (const [id, request] of this.requests) if (now - request.at > TTL) this.requests.delete(id);
  }
}
