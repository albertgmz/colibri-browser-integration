import { browser } from 'wxt/browser';
import { applyTheme, localize, showStatus, text } from '../../src/ui';
import type { CaptureRecord, Settings } from '../../src/types';
import '../../assets/ui.css';
import { explanationText, renderPolicy } from '../../src/policy-ui';
localize();
const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
const site = document.querySelector<HTMLInputElement>('#site')!;
const error = document.querySelector<HTMLElement>('#error')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
let settings: Settings;
let hostname = '';
async function refresh(): Promise<void> {
  const data = await browser.runtime.sendMessage({ type: 'popup-status' }) as { status: string; settings: Settings; recent: CaptureRecord[]; explanation?: unknown };
  settings = data.settings; applyTheme(settings); showStatus(data.status);
  renderPolicy(document.querySelector<HTMLElement>('#policy')!, settings);
  document.querySelector<HTMLElement>('#explanation')!.textContent = explanationText(data.explanation);
  enabled.checked = settings.enabled; enabled.disabled = data.status !== 'connected';
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try { hostname = tab?.url ? new URL(tab.url).hostname.toLowerCase() : ''; } catch { hostname = ''; }
  site.disabled = !hostname || data.status !== 'connected'; site.checked = settings.excludedSites.includes(hostname);
  document.querySelector<HTMLElement>('#siteName')!.textContent = hostname || text('popupNoSite');
  const recent = document.querySelector<HTMLElement>('#recent')!; recent.replaceChildren();
  if (!data.recent.length) { const li = document.createElement('li'); li.textContent = text('popupEmpty'); recent.append(li); }
  for (const entry of data.recent) {
    const li = document.createElement('li'); const name = document.createElement('strong'); name.textContent = entry.fileName;
    const state = document.createElement('span'); state.textContent = text(entry.state === 'attention' ? 'captureAttention' : entry.state === 'accepted' ? 'captureAccepted' : entry.state === 'pending' ? 'capturePending' : 'captureBrowser');
    if (entry.state === 'attention') state.setAttribute('role', 'status');
    li.append(name, state); recent.append(li);
  }
}
async function update(patch: Record<string, unknown>): Promise<void> {
  enabled.disabled = true; site.disabled = true; error.textContent = '';
  try { const reply = await browser.runtime.sendMessage({ type: 'settings-update', patch }); if (!reply?.ok) error.textContent = text('popupUpdateError'); }
  catch { error.textContent = text('popupUpdateError'); }
  try { await refresh(); } catch { enabled.disabled = site.disabled = true; showStatus('error'); }
}
enabled.addEventListener('change', () => { void update({ enabled: enabled.checked }); });
site.addEventListener('change', () => { void update({ excludedSites: site.checked ? [...new Set([...settings.excludedSites, hostname])] : settings.excludedSites.filter(value => value !== hostname) }); });
document.querySelector('#open')!.addEventListener('click', () => {
  error.textContent = '';
  void browser.runtime.sendMessage({ type: 'open' }).then(reply => {
    if (!reply?.ok) error.textContent = text('popupOpenError');
    return refresh();
  }).catch(() => { error.textContent = text('popupOpenError'); });
});
retry.addEventListener('click', () => {
  retry.disabled = true;
  void refresh().catch(() => { enabled.disabled = site.disabled = true; showStatus('error'); }).finally(() => { retry.disabled = false; });
});
document.querySelector('#setup')!.addEventListener('click', () => { void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') }); });
void refresh().catch(() => showStatus('error'));
