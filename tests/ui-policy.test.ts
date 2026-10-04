import { expect, test, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: { i18n: { getMessage: vi.fn(() => '') } } }));
import { explanationText } from '../src/policy-ui';
import { text } from '../src/ui';
test('English fallback substitutes named placeholders when browser lookup is unavailable', () => {
  expect(text('policyConstraints', ['12', 'Private capture off', '3'])).toBe('Minimum: 12 KiB · Private capture off · 3 exclusions');
});
test('pending and attention cannot be displayed as accepted from a reason alone', () => {
  expect(explanationText({ kind: 'handoff', outcome: 'pending', reason: 'preference' })).toBe(text('capturePending'));
  expect(explanationText({ kind: 'handoff', outcome: 'attention' })).toBe(text('captureAttention'));
  expect(explanationText({ kind: 'handoff', outcome: 'browser' })).toBe(text('reasonUnconfirmed'));
  expect(explanationText({ kind: 'policy', reason: 'https://private.test' })).not.toContain('private.test');
});
