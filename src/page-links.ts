import { normalizeLinks } from './link-picker';

/** Passive collection: never fetch candidates, read credentials or transmit DOM/text. */
export function collectPageLinks<T extends { href: string; download: string }>(anchors: Iterable<T>, pageUrl: string, include: (anchor: T) => boolean): ReturnType<typeof normalizeLinks> {
  const candidates = [];
  let examined = 0;
  for (const anchor of anchors) {
    if (++examined > 5000) break;
    if (include(anchor)) candidates.push({ url: anchor.href, fileName: anchor.download.slice(0, 1024), pageUrl });
  }
  return normalizeLinks(candidates);
}
