import { expect, test } from 'vitest';
import { RequestTracker } from '../src/request-context';
const url = 'https://example.test/a.zip?sig=one';
const request = { requestId: '1', url, method: 'GET', tabId: 2, frameId: 3, timeStamp: 1000, incognito: false };
const item = { id: 7, url };
test('private and normal requests with the same id and URL remain isolated', () => {
  const tracker = new RequestTracker(); tracker.observe(request);
  tracker.observe({ ...request, incognito: true, requestHeaders: [{ name: 'Authorization', value: 'private-fixture' }] });
  expect(tracker.find(item, 1001)?.headers).toEqual({});
  expect(tracker.find({ ...item, incognito: true }, 1001)?.headers).toEqual({ Authorization: 'private-fixture' });
  tracker.forget(item);
  expect(tracker.find({ ...item, incognito: true }, 1001)).toBeDefined();
});
test('redirect clears previous response metadata and omitted final-hop headers', () => {
  const tracker = new RequestTracker();
  tracker.observe({ ...request, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }, { name: 'Content-Length', value: '42' }, { name: 'Content-Disposition', value: 'attachment; filename=old.txt' }], statusCode: 302, redirectUrl: 'https://cdn.test/final.zip' });
  tracker.observe({ ...request, url: 'https://cdn.test/final.zip', responseHeaders: [], statusCode: 200 });
  expect(tracker.find({ ...item, finalUrl: 'https://cdn.test/final.zip' }, 1001)).toMatchObject({ responseStatus: 200, size: undefined, mimeType: undefined, contentDisposition: undefined });
});
test('a conflicting final URL cannot borrow context from the original URL', () => {
  const tracker = new RequestTracker(); tracker.observe(request);
  expect(tracker.find({ ...item, finalUrl: 'https://other.test/file.zip' }, 1001)).toBeUndefined();
});
test('frame identity is retained; cross-tab/frame races remain ambiguous', () => {
  const tracker = new RequestTracker(); tracker.observe(request);
  expect(tracker.find(item, 1001)).toMatchObject({ tabId: 2, frameId: 3, incognito: false });
  tracker.observe({ ...request, requestId: '2', tabId: 8, frameId: 4 });
  expect(tracker.find(item, 1001)).toBeUndefined();
});
test('different signed queries and expired contexts never reassociate', () => {
  const tracker = new RequestTracker(); tracker.observe(request);
  expect(tracker.find({ ...item, url: url.replace('one', 'two') }, 1001)).toBeUndefined();
  expect(tracker.find(item, 61001)).toBeUndefined();
});
test('a common redirect destination cannot join different signed original URLs', () => {
  const tracker = new RequestTracker(); tracker.observe({ ...request, redirectUrl: 'https://cdn.test/final.zip' });
  expect(tracker.find({ ...item, url: url.replace('one', 'two'), finalUrl: 'https://cdn.test/final.zip' }, 1001)).toBeUndefined();
});
