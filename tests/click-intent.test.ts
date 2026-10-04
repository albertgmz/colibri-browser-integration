import { expect, test } from 'vitest';
import { ClickIntents } from '../src/click-intent';
const context = { tabId: 1, frameId: 2, incognito: false, url: 'https://example.test/file.zip?sig=one' };
test('bypass is exact-link, frame and private scoped, consumed once', () => {
  const intents = new ClickIntents(); intents.add(context, { alt: true }, 1000);
  expect(intents.consume({ ...context, frameId: 3 }, 'alt', 1001)).toBe(false);
  expect(intents.consume({ ...context, incognito: true }, 'alt', 1001)).toBe(false);
  expect(intents.consume({ ...context, url: context.url.replace('one', 'two') }, 'alt', 1001)).toBe(false);
  expect(intents.consume(context, 'alt', 1001)).toBe(true);
  expect(intents.consume(context, 'alt', 1002)).toBe(false);
});
test('unrelated clicks do not grant bypass; expiry/navigation clear intent', () => {
  const intents = new ClickIntents(); intents.add(context, { alt: true }, 1000);
  expect(intents.consume(context, 'alt', 11001)).toBe(false);
  intents.add(context, { ctrl: true }, 12000); intents.clearTab(1);
  expect(intents.consume(context, 'ctrl', 12001)).toBe(false);
});
test('intent URLs are bounded and unsafe schemes are ignored', () => {
  const intents = new ClickIntents();
  intents.add({ ...context, url: 'javascript:fixture' }, { alt: true }, 1000);
  expect(intents.consume({ ...context, url: 'javascript:fixture' }, 'alt', 1001)).toBe(false);
});
test('a later ordinary click supersedes a canceled modifier click on the same link', () => {
  const intents = new ClickIntents(); intents.add(context, { alt: true }, 1000);
  intents.add(context, {}, 1001);
  expect(intents.consume(context, 'alt', 1002)).toBe(false);
});
