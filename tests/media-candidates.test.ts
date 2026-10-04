import { expect, test } from 'vitest';
import { mediaCandidates, MediaSessions } from '../src/media-candidates';
const page = 'https://page.test/frame';
test('direct filename media is bounded; manifests, DRM, blob and credentials are omitted', () => {
  const links = mediaCandidates([
    { url: 'https://cdn.test/a.mp4?sig=one#part', protected: false },
    { url: 'https://cdn.test/a.mp4?sig=one' }, { url: 'https://cdn.test/a.mp4?sig=two' },
    { url: 'https://cdn.test/audio.mp3' }, { url: 'https://cdn.test/stream.m3u8' },
    { url: 'https://cdn.test/stream.mpd' }, { url: 'blob:https://page.test/fixture' },
    { url: 'https://user:pass@cdn.test/a.mp4' }, { url: 'https://cdn.test/drm.mp4', protected: true },
  ], page);
  expect(links.map(link => link.url)).toEqual(['https://cdn.test/a.mp4?sig=one', 'https://cdn.test/a.mp4?sig=two', 'https://cdn.test/audio.mp3']);
  expect(links[0]).toMatchObject({ category: 'video', domain: 'cdn.test', fileName: 'a.mp4' });
  expect(mediaCandidates(Array.from({ length: 100 }, (_, i) => ({ url: `https://cdn.test/${i}.mp4` })), page)).toHaveLength(20);
});
test('an observed protected source cannot reappear through another element with the same URL', () => {
  expect(mediaCandidates([{ url: 'https://cdn.test/drm.mp4' }, { url: 'https://cdn.test/drm.mp4', protected: true }], page)).toEqual([]);
});
test('overlay sessions are tab/frame/private/page scoped, expiring and consumed once', () => {
  const sessions = new MediaSessions(); const identity = { tabId: 1, frameId: 3, privateWindow: true, pageUrl: page };
  const token = sessions.create(identity, 1000)!;
  expect(sessions.consume(token, { ...identity, frameId: 4 }, 1001)).toBe(false);
  expect(sessions.consume(token, { ...identity, privateWindow: false }, 1001)).toBe(false);
  expect(sessions.consume(token, { ...identity, pageUrl: page + '?changed' }, 1001)).toBe(false);
  expect(sessions.consume(token, identity, 1001)).toBe(true);
  expect(sessions.consume(token, identity, 1002)).toBe(false);
  expect(sessions.consume(sessions.create(identity, 1000)!, identity, 121001)).toBe(false);
});
test('overlay session count and navigation cleanup are bounded', () => {
  const sessions = new MediaSessions(); const identity = { tabId: 1, frameId: 0, privateWindow: false, pageUrl: page };
  for (let i = 0; i < 32; i++) expect(sessions.create({ ...identity, tabId: i }, 1000)).toBeDefined();
  expect(sessions.create({ ...identity, tabId: 100 }, 1000)).toBeUndefined();
  sessions.clearTab(1); expect(sessions.create({ ...identity, tabId: 100 }, 1001)).toBeDefined();
});
test('reserved preparation is one flight and closure/navigation invalidates its guard', () => {
  const sessions = new MediaSessions(); const identity = { tabId: 1, frameId: 0, privateWindow: false, pageUrl: page }; const now = Date.now();
  const token = sessions.create(identity, now)!; const valid = sessions.begin(token, identity, now)!;
  expect(valid()).toBe(true); expect(sessions.begin(token, identity, now)).toBeUndefined();
  expect(sessions.consume(token, identity, now)).toBe(true); expect(valid()).toBe(false);
  const another = sessions.create(identity, now)!; const guard = sessions.begin(another, identity, now)!;
  sessions.clearTab(1); expect(guard()).toBe(false);
});
