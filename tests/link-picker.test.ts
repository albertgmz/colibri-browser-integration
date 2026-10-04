import { expect, test, vi } from 'vitest';
import { normalizeLinks, visibleLinks, selectVisible, PickerSessions, MAX_SELECTED } from '../src/link-picker';
import { DEFAULT_SETTINGS } from '../src/settings';
import { collectPageLinks } from '../src/page-links';
import type { HostReply } from '../src/types';

const page = 'https://page.example/frame?private=fixture';
const rows = () => normalizeLinks([
  { url: 'https://files.example/a.zip?sig=one#x', pageUrl: page },
  { url: 'https://files.example/a.zip?sig=one#y', pageUrl: 'https://different.example/' },
  { url: 'https://files.example/a.zip?sig=two', pageUrl: page },
  { url: 'https://files.example/b.pdf', fileName: 'report.pdf', pageUrl: page },
  { url: 'javascript:alert(1)', pageUrl: page },
]);
test('deduplicates fragments without combining signed queries or replacing frame context', () => {
  expect(rows()).toHaveLength(3);
  expect(rows()[0]).toMatchObject({ url: 'https://files.example/a.zip?sig=one', pageUrl: page });
  expect(normalizeLinks(Array.from({ length: 700 }, (_, i) => ({ url: `https://files.example/${i}`, pageUrl: page })))).toHaveLength(500);
  expect(normalizeLinks([{ url: 'https://user:pass@files.example/a.zip', pageUrl: page }])).toEqual([]);
});
test('filter and visible selection preserve hidden selections and enforce the submission bound', () => {
  const links = rows(); const selected = new Set([links[0]!.id]);
  const visible = visibleLinks(links, 'REPORT');
  selectVisible(selected, visible, true);
  expect(selected.size).toBe(2);
  selectVisible(selected, visible, false);
  expect([...selected]).toEqual([links[0]!.id]);
  const many = normalizeLinks(Array.from({ length: 500 }, (_, i) => ({ url: `https://files.example/${i}`, pageUrl: page })));
  const capped = new Set<string>(); selectVisible(capped, many, true);
  expect(capped.size).toBe(MAX_SELECTED);
});
function setup() {
  let now = 1000;
  let settings = { ...DEFAULT_SETTINGS, excludedSites: [] as string[] };
  const cookies = vi.fn(async () => 'synthetic=fixture');
  const send = vi.fn(async (message: Record<string, unknown>, timeout?: number): Promise<HostReply> => {
    void message; void timeout; return { ok: true, accepted: true, state: 'accepted' };
  });
  const hello = vi.fn(async () => ({ ok: true, protocolVersion: 2, capabilities: ['capture-confirmation', 'bulk-add'] }));
  const sessions = new PickerSessions({ now: () => now, settings: async () => settings, cookies, send, hello, wait: async () => {} });
  const id = sessions.create(rows(), false); sessions.attach(id!, 9);
  return { sessions, id: id!, cookies, send, hello, setNow: (n: number) => { now = n; }, setSettings: (s: typeof settings) => { settings = s; } };
}
test('sessions reject other tabs, expire, and are bounded', async () => {
  const s = setup(); expect(s.sessions.get(s.id, 10)).toBeUndefined();
  expect(await s.sessions.submit(s.id, 10, ['0'])).toEqual({ state: 'expired' });
  s.setNow(301001); expect(s.sessions.get(s.id, 9)).toBeUndefined();
  expect(s.cookies).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i++) expect(s.sessions.create(rows(), false)).toBeDefined();
  expect(s.sessions.create(rows(), false)).toBeUndefined();
});
test('content collection visits at most 5000 anchors and retains the collecting frame', () => {
  const include = vi.fn((anchor: { href: string; download: string }) => anchor.download === 'picked.zip');
  const anchors = Array.from({ length: 6000 }, (_, i) => ({ href: `https://files.example/${i}`, download: i === 10 ? 'picked.zip' : '' }));
  const links = collectPageLinks(anchors, page, include);
  expect(include).toHaveBeenCalledTimes(5000);
  expect(links).toHaveLength(1); expect(links[0]).toMatchObject({ pageUrl: page, fileName: 'picked.zip' });
});
test('pending confirmation does not establish acceptance and explicit cleanup pending is attention', async () => {
  const s = setup();
  s.send.mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'capture' })
    .mockResolvedValueOnce({ ok: false, error: 'timeout' })
    .mockResolvedValueOnce({ ok: true, state: 'pending', accepted: false, captureId: 'capture' });
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'attention' });
  expect(s.sessions.get(s.id, 9)?.links).toEqual([]);
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'attention' });
  expect(s.send).toHaveBeenCalledTimes(3);
});
test.each(['close', 'expire'])('preflight %s during cookie lookup cannot send an offer', async action => {
  const s = setup();
  let finish: (cookie: string) => void = () => {};
  s.cookies.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const offer = s.sessions.submit(s.id, 9, ['0', '1']);
  await vi.waitFor(() => expect(s.cookies).toHaveBeenCalledTimes(1));
  if (action === 'close') s.sessions.closeTab(9); else s.setNow(301001);
  finish('synthetic=fixture');
  expect(await offer).toEqual({ state: 'expired' });
  expect(s.cookies).toHaveBeenCalledTimes(1); expect(s.send).not.toHaveBeenCalled();
});
test.each(['close', 'expire'])('preflight %s during handshake cannot read cookies', async action => {
  const s = setup();
  let finish: (reply: { ok: boolean; protocolVersion: number; capabilities: string[] }) => void = () => {};
  s.hello.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const offer = s.sessions.submit(s.id, 9, ['0']);
  if (action === 'close') s.sessions.closeTab(9); else s.setNow(301001);
  finish({ ok: true, protocolVersion: 2, capabilities: ['capture-confirmation', 'bulk-add'] });
  expect(await offer).toEqual({ state: 'expired' });
  expect(s.cookies).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled();
});
test('lost offer replies prevent retry from the same picker', async () => {
  const s = setup(); s.send.mockRejectedValue(new Error('disconnected'));
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'browser' });
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'browser' });
  expect(s.send).toHaveBeenCalledTimes(1);
});
test('closing an already pending picker still resolves authoritative acceptance without another offer', async () => {
  const s = setup(); let finish: (reply: HostReply) => void = () => {};
  s.send.mockResolvedValueOnce({ ok: true, state: 'pending', captureId: 'capture' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const offer = s.sessions.submit(s.id, 9, ['0']);
  await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
  s.sessions.closeTab(9); finish({ ok: true, state: 'accepted', accepted: true });
  expect(await offer).toEqual({ state: 'accepted' });
  expect(s.send.mock.calls.filter(([message]) => message.type === 'bulk-add')).toHaveLength(1);
});
test('closing a tab discards its session', () => {
  const s = setup(); s.sessions.closeTab(9);
  expect(s.sessions.get(s.id, 9)).toBeUndefined();
});
test('selected links alone get cookies and retain their own referrer; duplicate submissions share one offer', async () => {
  const s = setup();
  const first = s.sessions.submit(s.id, 9, ['0', '2']);
  const second = s.sessions.submit(s.id, 9, ['0', '2']);
  expect(await first).toEqual({ state: 'accepted' }); expect(await second).toEqual({ state: 'accepted' });
  expect(s.cookies).toHaveBeenCalledTimes(2); expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.send.mock.calls[0]![0]).toMatchObject({ type: 'bulk-add', links: [
    { url: rows()[0]!.url, referrer: 'https://page.example/', cookies: 'synthetic=fixture' },
    { url: rows()[2]!.url, referrer: 'https://page.example/', cookies: 'synthetic=fixture' },
  ] });
});
test('exclusions and private opt-out are rechecked before reading cookies', async () => {
  const s = setup(); s.setSettings({ ...DEFAULT_SETTINGS, excludedSites: ['page.example'] });
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'excluded' });
  const privateId = s.sessions.create(rows(), true)!; s.sessions.attach(privateId, 11);
  expect(await s.sessions.submit(privateId, 11, ['0'])).toEqual({ state: 'private' });
  expect(s.cookies).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled();
});
test('unnegotiated bulk support blocks credentials', async () => {
  const s = setup(); s.hello.mockResolvedValue({ ok: true, protocolVersion: 2, capabilities: ['capture-confirmation'] });
  expect(await s.sessions.submit(s.id, 9, ['0'])).toEqual({ state: 'incompatible' });
  expect(s.cookies).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled();
});
test('unknown, empty and oversized selections are refused without credentials', async () => {
  const s = setup();
  for (const ids of [[], ['unknown'], Array.from({ length: 101 }, (_, i) => String(i))]) {
    expect(await s.sessions.submit(s.id, 9, ids)).toEqual({ state: 'invalid' });
  }
  expect(s.cookies).not.toHaveBeenCalled();
});
