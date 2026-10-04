import { captureCatalog, captureReasons, type CaptureCategoryId, type CaptureReason } from './generated/capture-catalog';
import type { CaptureAction } from './generated/capture-rules';
import type { Settings } from './types';

export interface CaptureExplanation {
  kind: 'policy' | 'association' | 'bypass' | 'handoff';
  reason?: CaptureReason;
  outcome?: 'pending' | 'accepted' | 'browser' | 'attention';
}
/** Boundary for the memory-only browser summary; never retains arbitrary host text. */
export function sanitizeExplanation(value: unknown): CaptureExplanation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !['policy', 'association', 'bypass', 'handoff'].includes(raw.kind)) return undefined;
  const result: CaptureExplanation = { kind: raw.kind as CaptureExplanation['kind'] };
  if (typeof raw.reason === 'string' && Object.values(captureReasons).includes(raw.reason as CaptureReason)) result.reason = raw.reason as CaptureReason;
  if (typeof raw.outcome === 'string' && ['pending', 'accepted', 'browser', 'attention'].includes(raw.outcome)) result.outcome = raw.outcome as CaptureExplanation['outcome'];
  return result;
}
export function policySummary(settings: Settings): { legacy: boolean; rows: { id: CaptureCategoryId; action: CaptureAction }[]; overrides: number } {
  if (!settings.capturePolicy) return { legacy: true, rows: [], overrides: 0 };
  return { legacy: false, rows: captureCatalog.categories.map(category => ({ id: category.id, action: settings.capturePolicy!.categories[category.id] ?? 'ask' })),
    overrides: Object.keys(settings.capturePolicy.extensions).length };
}
