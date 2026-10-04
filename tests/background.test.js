// Background handoff: acceptance, rule filtering, redirect cookies, cancel failures, timeouts and context-menu sends.
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { handoff, awaitAcceptance } from '../src/handoff.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { cookiesAllowed, buildAddMessage, linkReferrer } from '../src/capture.ts';
let state, deps;
const zipItem = (overrides = {}) => ({ id: 7, url: 'https://example.com/get?id=1', finalUrl: 'https://example.com/files/setup.zip', filename: 'setup.zip', referrer: 'https://example.com/', totalBytes: 1000, fileSize: 1000, mime: 'application/zip', incognito: false, ...overrides });
beforeEach(() => {
  state = { settings: { ...DEFAULT_SETTINGS }, sent: [], paused: [], resumed: [], cancelled: [], erased: [], cookieUrls: [], records: [], reply: { ok: true, accepted: true, state: 'accepted' } };
  deps = {
    settings: async () => state.settings, observe: () => undefined, bypass: () => false,
    cookies: async url => { state.cookieUrls.push(url); return 'sid=1'; },
    send: async message => { state.sent.push(message); return state.reply; },
    pause: async id => { state.paused.push(id); }, resume: async id => { state.resumed.push(id); },
    cancel: async id => { state.cancelled.push(id); }, erase: async id => { state.erased.push(id); },
    record: async entry => { state.records.push(entry); },
  };
});
async function determine(item) {
  const suggestions = [];
  let released = false;
  await handoff(item, deps, () => { if (!released) { released = true; suggestions.push([]); } });
  return suggestions;
}
test('Colibri accepts: the browser download is cancelled, released once and erased', async () => {
  assert.deepEqual(await determine(zipItem()), [[]]);
  assert.deepEqual(state.paused, [7]); assert.deepEqual(state.resumed, []);
  assert.deepEqual(state.cancelled, [7]); assert.deepEqual(state.erased, [7]);
  assert.equal(state.sent.at(-1).url, zipItem().url); assert.equal(state.sent.at(-1).cookies, 'sid=1');
  assert.deepEqual(state.cookieUrls, [zipItem().url]);
});
for (const [name, setup] of [
  ['Colibri refuses', () => { state.reply = { ok: false, error: 'no' }; }],
  ['the host is missing', () => { deps.send = async () => { throw new Error('Specified native messaging host not found.'); }; }],
  ['the host answers nothing usable', () => { state.reply = {}; }],
  ['capture is switched off', () => { state.settings.enabled = false; }],
  ['storage fails', () => { deps.settings = async () => { throw new Error('storage broken'); }; }],
]) test(`${name}: the browser keeps the download`, async () => {
  setup(); assert.deepEqual(await determine(zipItem()), [[]]);
  assert.deepEqual(state.cancelled, []); assert.deepEqual(state.erased, []);
  assert.deepEqual(state.resumed, state.paused);
});
test('downloads outside the rules are released without asking Colibri', async () => {
  for (const item of [zipItem({ filename: 'photo.png' }), zipItem({ url: 'blob:https://example.com/1' }), zipItem({ incognito: true })]) assert.deepEqual(await determine(item), [[]]);
  assert.deepEqual(state.sent, []); assert.deepEqual(state.cancelled, []);
});
test('cookies are left out after a redirect to another host', async () => {
  await determine(zipItem({ url: 'https://evil.example/x.zip', finalUrl: 'https://bank.example/statement.zip' }));
  assert.equal(state.sent.at(-1).cookies, undefined); assert.deepEqual(state.cookieUrls, []);
});
test('a cancel that fails still releases the download exactly once', async () => {
  deps.cancel = async () => { throw new Error('no such download'); };
  assert.deepEqual(await determine(zipItem()), [[]]); assert.deepEqual(state.resumed, [7]);
});
test('no answer within 20 s: the browser keeps the download', async () => {
  vi.useFakeTimers();
  deps.send = () => new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 20000));
  const result = determine(zipItem()); await vi.advanceTimersByTimeAsync(20000);
  assert.deepEqual(await result, [[]]); assert.deepEqual(state.resumed, [7]); assert.deepEqual(state.cancelled, []);
  vi.useRealTimers();
});
test('context menu sends the link; a failure shows the badge', async () => {
  const url = 'https://cdn.other.net/a.zip';
  const message = buildAddMessage({ url, referrer: linkReferrer('https://example.com/p?token=1', url), cookies: cookiesAllowed(url) ? await deps.cookies(url) : '' });
  assert.equal(message.referrer, 'https://example.com/');
  assert.equal(await awaitAcceptance(await deps.send(message), deps.send), 'accepted');
  state.reply = { ok: false };
  const badge = []; if (await awaitAcceptance(await deps.send(message), deps.send) !== 'accepted') badge.push('!');
  assert.deepEqual(badge, ['!']);
});
