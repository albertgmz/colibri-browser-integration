import type { AddContext, AddMessage, CaptureRules, DownloadItem, HostReply } from "./types";
import { actionForFile, validPolicy, normalizedExclusion } from './generated/capture-rules';
import { captureCatalog, captureReasons, fileBaseName, fileExtension } from './generated/capture-catalog';
// Pure capture logic: no chrome.* access, so it runs (and is tested) in Node as well.
// Everything here works on data the browser reports about a download; the native host and Colibri
// validate the resulting message again.

/** Capture rules used until Colibri has sent its own (the defaults of Colibri's settings). */
export const DEFAULT_RULES = Object.freeze({
  extensions: Object.freeze([...captureCatalog.legacyCaptureExtensions]),
  minSizeKiB: 0,
});

/** Colibri's limits for an "add" message (lengths in UTF-16 code units, as in .NET). */
export const LIMITS = Object.freeze({
  url: 8192,
  fileName: 1024,
  cookies: 64 * 1024,
  userAgent: 1024,
  mimeType: 255,
  extensions: 256,
  extensionLength: 16,
});

const CAPTURABLE_SCHEMES = new Set(['http:', 'https:', 'ftp:']);

/** True for absolute http, https and ftp URLs with a host, within the length limit. blob:, data: and the rest stay in the browser. */
export function isCapturableUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > LIMITS.url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return CAPTURABLE_SCHEMES.has(parsed.protocol) && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** No control characters except tab: what Colibri accepts in a header value. */
export function isSafeHeaderValue(value: unknown): value is string {
  return typeof value === 'string' && !/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value);
}

/** The last part of a path, whichever separator the OS uses ("C:\\Users\\a\\file.zip" -> "file.zip"). */
export function baseName(path: unknown): string {
  if (typeof path !== 'string') {
    return '';
  }

  return fileBaseName(path);
}

/** The file name at the end of a URL's path, decoded; '' when there is none. */
export function fileNameFromUrl(url: string): string {
  try {
    const name = baseName(new URL(url).pathname);
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  } catch {
    return '';
  }
}

/** "Setup.EXE" -> "exe"; '' when the name has no extension (or only a leading dot). */
export function extensionOf(fileName: string): string {
  return fileExtension(fileName);
}

/** The download's size in bytes, or null when unknown (the browser reports 0 or -1 then). */
export function knownSize(item: DownloadItem): number | null {
  for (const value of [item.totalBytes, item.fileSize]) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      return value;
    }
  }

  return null;
}

/** The file name the download will have: the browser's suggestion, else the end of the URL. */
export function downloadFileName(item: DownloadItem): string {
  return baseName(item.filename) || fileNameFromUrl(item.finalUrl || item.url);
}

/** Whether a download matches the rules: its extension is listed, and its size (when known) is at least the minimum. */
export function matchesRules(rules: CaptureRules, { fileName, size }: { fileName: string; size: number | null }): boolean {
  if (!rules.extensions.includes(extensionOf(fileName))) {
    return false;
  }

  return size === null || size >= rules.minSizeKiB * 1024;
}

/**
 * Decides whether to hand a browser download to Colibri. Returns { capture: true } or
 * { capture: false, reason } (the reason is only for debugging).
 */
export function decideCapture({ enabled, rules, item }: { enabled: boolean; rules: CaptureRules; item: DownloadItem }): { capture: boolean; reason?: string; action?: "capture" | "ask" } {
  if (!enabled) {
    return { capture: false, reason: captureReasons.disabled };
  }

  // Private windows stay private: Colibri would keep the download in its history.
  if (item.incognito) {
    return { capture: false, reason: captureReasons.incognito };
  }

  if (!isCapturableUrl(item.url)) {
    return { capture: false, reason: captureReasons.scheme };
  }

  if (rules.capturePolicy) {
    const size = knownSize(item);
    if (size !== null && size < rules.minSizeKiB * 1024) return { capture: false, reason: captureReasons.minimum };
    const action = actionForFile(rules.capturePolicy, downloadFileName(item));
    return action === 'browser' ? { capture: false, reason: captureReasons.preference } : { capture: true, action };
  }
  if (!matchesRules(rules, { fileName: downloadFileName(item), size: knownSize(item) })) {
    return { capture: false, reason: captureReasons.rules };
  }

  return { capture: true };
}

/**
 * Whether cookies may go along with a captured download. Colibri requests `url` and sends the cookies on every
 * request, also after a redirect, so cookies are sent only when the download stays on the host they belong to:
 * after a redirect to another host they would reach a server they were never meant for.
 */
export function cookiesAllowed(url: string, finalUrl?: string): boolean {
  if (!finalUrl || finalUrl === url) {
    return true;
  }

  try {
    return new URL(url).host === new URL(finalUrl).host;
  } catch {
    return false;
  }
}

/**
 * The referrer for a link sent from the context menu: the whole page URL for a link on the same site, only
 * the page's origin for another site (what the browser itself sends by default), so tokens in the page URL
 * stay private. '' when the page has no http(s) origin.
 */
export function linkReferrer(pageUrl: string | undefined, linkUrl: string): string {
  try {
    if (!pageUrl) return "";
    const page = new URL(pageUrl);
    if (page.protocol !== 'http:' && page.protocol !== 'https:') {
      return '';
    }

    return page.origin === new URL(linkUrl).origin ? pageUrl : `${page.origin}/`;
  } catch {
    return '';
  }
}

/** chrome.cookies.Cookie[] -> "a=b; c=d" (a cookie without a name is sent as its value alone). */
export function cookieHeader(cookies: { name: string; value: string }[]): string {
  return cookies
    .map((cookie) => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))
    .filter((pair) => pair.length > 0)
    .join('; ');
}

/**
 * Builds the "add" message for the native host. Optional fields that are missing, too long or unsafe are
 * left out. Returns null when the download cannot be handed over as it is (bad URL, or cookies Colibri
 * would refuse; without them the download would fail), so the browser keeps it.
 */
export function buildAddMessage({ url, finalUrl, fileName, referrer, cookies, userAgent, size, mimeType }: AddContext): AddMessage | null {
  if (!isCapturableUrl(url)) {
    return null;
  }

  const message: AddMessage = { type: 'add', url };
  if (finalUrl && finalUrl !== url && isCapturableUrl(finalUrl)) {
    message.finalUrl = finalUrl;
  }

  const name = baseName(fileName);
  if (name && name.length <= LIMITS.fileName && isSafeHeaderValue(name)) {
    message.fileName = name;
  }

  if (referrer && isCapturableUrl(referrer) && isSafeHeaderValue(referrer)) {
    message.referrer = referrer;
  }

  if (cookies) {
    if (cookies.length > LIMITS.cookies || !isSafeHeaderValue(cookies)) {
      return null;
    }

    message.cookies = cookies;
  }

  if (userAgent && userAgent.length <= LIMITS.userAgent && isSafeHeaderValue(userAgent)) {
    message.userAgent = userAgent;
  }

  if (typeof size === "number" && Number.isSafeInteger(size) && size > 0) {
    message.size = size;
  }

  if (mimeType && mimeType.length <= LIMITS.mimeType && isSafeHeaderValue(mimeType)) {
    message.mimeType = mimeType;
  }

  return message;
}

/** Turns the host's answer to "config" into rules, or null when it is not a valid answer. */
export function rulesFromConfig(response: HostReply | null | undefined): CaptureRules | null {
  if (!response || response.ok !== true) {
    return null;
  }

  const { captureExtensions, minSizeKiB } = response;
  if (!Array.isArray(captureExtensions) || captureExtensions.length > LIMITS.extensions
    || typeof minSizeKiB !== "number" || !Number.isSafeInteger(minSizeKiB) || minSizeKiB < 0) {
    return null;
  }

  const pattern = new RegExp(`^[a-z0-9]{1,${LIMITS.extensionLength}}$`);
  const extensions = captureExtensions.map((e) => (typeof e === 'string' ? e.toLowerCase() : ''));
  if (!extensions.every((e) => pattern.test(e))) {
    return null;
  }

  const policy = response.capturePolicy;
  const exclusions = response.exclusionRules;
  if (policy !== undefined && !validPolicy(policy)) return null;
  if (exclusions !== undefined && (!Array.isArray(exclusions) || exclusions.length > 256 || !exclusions.every(e => typeof e === 'string' && normalizedExclusion(e)))) return null;
  return { extensions, minSizeKiB, ...(validPolicy(policy) ? { capturePolicy: policy } : {}), ...(Array.isArray(exclusions) ? { exclusionRules: exclusions as string[] } : {}) };
}

/** Rules read back from storage: valid ones as they are, anything else gives the defaults. */
export function storedRulesOrDefault(stored: CaptureRules | undefined): CaptureRules {
  return rulesFromConfig(stored ? { ok: true, captureExtensions: stored.extensions, minSizeKiB: stored.minSizeKiB } : null)
    ?? { extensions: [...DEFAULT_RULES.extensions], minSizeKiB: DEFAULT_RULES.minSizeKiB };
}

/**
 * Connection state for the popup, from the answer to "ping":
 * 'connected', 'notRunning' (host reached, Colibri closed), 'hostMissing' (the browser cannot start
 * the host: not registered, or registered for another extension ID) or 'error'.
 */
export function connectionStatus(response: HostReply | undefined): string {
  if (response?.ok === true) {
    return 'connected';
  }

  if (response?.error === 'app-not-running') {
    return 'notRunning';
  }
  if (response?.error === 'protocol-mismatch') return 'incompatible';

  // Chrome's and Edge's runtime.lastError texts: "Specified native messaging host not found." and
  // "Access to the specified native messaging host is forbidden."
  const nativeError = response?.nativeError ?? '';
  if (/not found|forbidden/i.test(nativeError)) {
    return 'hostMissing';
  }

  return 'error';
}
