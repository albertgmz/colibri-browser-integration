import { policySummary, sanitizeExplanation } from './capture-explanation';
import { text, type MessageKey } from './ui';
import type { Settings } from './types';

const categories: Record<string, MessageKey> = { compressed: 'categoryCompressed', documents: 'categoryDocuments', music: 'categoryMusic', programs: 'categoryPrograms', video: 'categoryVideo', other: 'categoryOther' };
export function categoryText(id: string): string { return text(categories[id] ?? 'categoryOther'); }
const reasons: Record<string, MessageKey> = { disabled: 'reasonDisabled', private: 'reasonPrivate', incognito: 'reasonPrivate', excluded: 'reasonExcluded', method: 'reasonMethod', minimum: 'reasonMinimum', preference: 'reasonPreference', scheme: 'reasonScheme', rules: 'reasonRules', safety: 'reasonSafety' };
export function explanationText(value: unknown): string {
  const summary = sanitizeExplanation(value);
  if (!summary) return text('reasonNone');
  if (summary.outcome === 'accepted') return text('captureAccepted');
  if (summary.outcome === 'pending') return text('capturePending');
  if (summary.outcome === 'attention') return text('captureAttention');
  if (summary.reason && reasons[summary.reason]) return text(reasons[summary.reason]!);
  if (summary.kind === 'bypass') return text('reasonBypass');
  if (summary.kind === 'association') return text('reasonAssociation');
  return text('reasonUnconfirmed');
}
export function renderPolicy(target: HTMLElement, settings: Settings): void {
  target.replaceChildren();
  const summary = policySummary(settings);
  if (summary.legacy) {
    const p = document.createElement('p'); p.textContent = text('policyLegacy'); target.append(p);
  } else {
    const list = document.createElement('dl'); list.className = 'policy-list';
    for (const row of summary.rows) {
      const label = document.createElement('dt'); label.textContent = text(categories[row.id]!);
      const action = document.createElement('dd'); action.textContent = text(row.action === 'capture' ? 'actionCapture' : row.action === 'browser' ? 'actionBrowser' : 'actionAsk');
      list.append(label, action);
    }
    target.append(list);
    const overrides = document.createElement('p'); overrides.className = 'hint'; overrides.textContent = text('policyOverrides', [String(summary.overrides)]); target.append(overrides);
  }
  const constraints = document.createElement('p'); constraints.className = 'hint';
  constraints.textContent = text('policyConstraints', [String(settings.minSizeKiB), text(settings.capturePrivate ? 'privateAllowed' : 'privateOff'), String(settings.excludedSites.length + (settings.exclusionRules?.length ?? 0))]);
  target.append(constraints);
}
