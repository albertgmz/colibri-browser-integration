import type { CapturePolicy } from "./generated/capture-rules";
export interface CaptureRules { extensions: readonly string[]; minSizeKiB: number; capturePolicy?: CapturePolicy; exclusionRules?: string[] }
export interface Settings extends CaptureRules {
  enabled: boolean; excludedSites: string[]; capturePrivate: boolean;
  bypassModifier: 'none' | 'alt' | 'ctrl' | 'shift'; theme: 'system' | 'light' | 'dark'; accent: string;
  palette: 'warm' | 'graphite' | 'ocean' | 'forest';
}
export interface DownloadItem {
  id: number; url: string; finalUrl?: string; filename?: string; referrer?: string;
  totalBytes?: number; fileSize?: number; mime?: string; incognito?: boolean; state?: string;
}
export interface AddContext {
  url: string; finalUrl?: string; fileName?: string; referrer?: string; cookies?: string;
  userAgent?: string; size?: number | null; mimeType?: string; headers?: Record<string, string>;
  redirects?: string[]; contentDisposition?: string; responseStatus?: number; requestMethod?: string; captureAction?: "capture" | "ask"; privateWindow?: boolean;
}
export interface AddMessage extends AddContext { type: 'add' }
export interface HostReply {
  requestId?: string; ok?: boolean; error?: string; nativeError?: string; protocolVersion?: number;
  appVersion?: string; capabilities?: string[]; accepted?: boolean; pending?: boolean;
  state?: string; captureId?: string; type?: string;
  capturePolicy?: unknown; exclusionRules?: unknown; decisionReason?: string; captureExtensions?: unknown; minSizeKiB?: unknown; enabled?: unknown; excludedSites?: unknown;
  capturePrivate?: unknown; bypassModifier?: unknown; theme?: unknown; accent?: unknown; palette?: unknown;
}
export interface CaptureRecord { fileName: string; state: 'pending' | 'accepted' | 'browser' | 'attention'; at: number }
