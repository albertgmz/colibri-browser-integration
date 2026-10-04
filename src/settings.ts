import { exclusionMatches } from './generated/capture-rules';
import { DEFAULT_RULES, rulesFromConfig } from './capture';
import type { HostReply, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  extensions: [...DEFAULT_RULES.extensions], minSizeKiB: 0, enabled: true, excludedSites: [],
  capturePrivate: false, bypassModifier: 'none', theme: 'system', accent: '#C42B1C', palette: 'warm',
};
export function settingsFromReply(reply: HostReply): Settings | null {
  const rules = rulesFromConfig(reply);
  if (!rules) return null;
  const sites = reply.excludedSites;
  if (sites !== undefined && (!Array.isArray(sites) || sites.length > 256 ||
      !sites.every((site: unknown) => typeof site === 'string' && /^[a-z0-9.-]{1,253}$/i.test(site)))) return null;
  const modifier = reply.bypassModifier;
  const theme = reply.theme;
  return { ...DEFAULT_SETTINGS, ...rules,
    enabled: reply.enabled !== false, capturePrivate: reply.capturePrivate === true,
    excludedSites: Array.isArray(sites) ? sites as string[] : [],
    bypassModifier: modifier === 'alt' || modifier === 'ctrl' || modifier === 'shift' ? modifier : 'none',
    theme: theme === 'dark' || theme === 'light' ? theme : 'system',
    palette: reply.palette === 'graphite' || reply.palette === 'ocean' || reply.palette === 'forest' ? reply.palette : 'warm',
    accent: typeof reply.accent === 'string' && /^#[a-f\d]{6}$/i.test(reply.accent) ? reply.accent : DEFAULT_SETTINGS.accent,
  };
}
export function siteExcluded(settings: Settings, urls: (string | undefined)[], fileName = ''): boolean {
  return urls.some(url => {
    if (!url) return false;
    try { return settings.excludedSites.includes(new URL(url).hostname.toLowerCase()) || (settings.exclusionRules ?? []).some(r => exclusionMatches(r, url, fileName)); } catch { return false; }
  });
}
