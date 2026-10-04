import { browser } from 'wxt/browser';
import { applyTheme, localize, text, type MessageKey } from '../../src/ui';
import { MAX_SELECTED, selectVisible, visibleLinks, type PickerLink, type PickerState } from '../../src/link-picker';
import { siteExcluded } from '../../src/settings';
import type { Settings } from '../../src/types';
import { categoryForFileName } from '../../src/generated/capture-catalog';
import { categoryText } from '../../src/policy-ui';
import '../../assets/ui.css';

localize();
const session = new URL(location.href).searchParams.get('session') ?? '';
const search = document.querySelector<HTMLInputElement>('#search')!;
const list = document.querySelector<HTMLUListElement>('#links')!;
const submit = document.querySelector<HTMLButtonElement>('#submit')!;
const select = document.querySelector<HTMLButtonElement>('#select')!;
const clear = document.querySelector<HTMLButtonElement>('#clear')!;
const status = document.querySelector<HTMLElement>('#status')!;
const selected = new Set<string>();
let links: PickerLink[] = [];
let settings: Settings;
let state: PickerState = 'ready';
let busy = false;
const states: Record<PickerState, MessageKey> = {
  ready: 'pickerReady', pending: 'pickerPending', accepted: 'pickerAccepted', browser: 'pickerBrowser',
  attention: 'pickerAttention', expired: 'pickerExpired', invalid: 'pickerInvalid', excluded: 'pickerExcluded',
  private: 'pickerPrivate', incompatible: 'popupProtocolError',
};
const available = (link: PickerLink) => !siteExcluded(settings, [link.url, link.pageUrl], link.fileName);
function updateControls(): void {
  const locked = busy || state !== 'ready';
  submit.disabled = locked || !selected.size;
  search.disabled = select.disabled = clear.disabled = locked;
  document.querySelector<HTMLElement>('#count')!.textContent = text('pickerCount', [String(selected.size), String(MAX_SELECTED), String(links.length)]);
  const counts = new Map<string, number>();
  for (const link of links.filter(link => selected.has(link.id))) {
    const category = categoryForFileName(link.fileName); counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  document.querySelector<HTMLElement>('#preview')!.textContent = counts.size ? text('pickerCategoryPreview', [[...counts].map(([id, count]) => `${categoryText(id)}: ${count}`).join(' · ')]) : '';
  for (const input of list.querySelectorAll<HTMLInputElement>('input')) {
    const link = links.find(link => link.id === input.value)!;
    input.disabled = locked || !available(link) || (!selected.has(link.id) && selected.size >= MAX_SELECTED);
  }
}
function render(): void {
  list.replaceChildren();
  const visible = visibleLinks(links, search.value);
  document.querySelector<HTMLElement>('#empty')!.hidden = visible.length > 0;
  for (const link of visible) {
    const li = document.createElement('li'); const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = link.id; input.checked = selected.has(link.id);
    const detail = document.createElement('span'); const name = document.createElement('strong');
    name.textContent = link.fileName || text('pickerUnnamed');
    const hints = document.createElement('span');
    hints.textContent = [link.domain, link.extension ? text('pickerType', [link.extension.toUpperCase()]) : text('pickerUnknownType'), text('pickerCategoryHint', [categoryText(categoryForFileName(link.fileName))]), text('pickerUnknownSize'),
      ...(!available(link) ? [text('pickerExcludedRow')] : [])].join(' · ');
    detail.append(name, hints); label.append(input, detail); li.append(label); list.append(li);
    input.addEventListener('change', () => {
      if (input.checked && selected.size < MAX_SELECTED) selected.add(link.id); else selected.delete(link.id);
      input.checked = selected.has(link.id); updateControls();
    });
  }
  updateControls();
}
async function refresh(): Promise<void> {
  const data = await browser.runtime.sendMessage({ type: 'picker-get', session });
  settings = data.settings; applyTheme(settings);
  links = data.links; state = data.state;
  status.textContent = text(states[state] ?? 'pickerExpired'); render();
  if (state === 'pending') setTimeout(() => { void refresh().catch(() => { status.textContent = text('pickerBrowser'); }); }, 1000);
}
search.addEventListener('input', render);
select.addEventListener('click', () => { selectVisible(selected, visibleLinks(links, search.value).filter(available), true); render(); });
clear.addEventListener('click', () => { selectVisible(selected, visibleLinks(links, search.value), false); render(); });
submit.addEventListener('click', () => {
  busy = true; status.textContent = text('pickerPending'); render();
  void browser.runtime.sendMessage({ type: 'picker-submit', session, ids: [...selected] }).then(async result => {
    await refresh();
    status.textContent = text(states[result.state as PickerState] ?? 'pickerBrowser');
  }).catch(async () => {
    // A lost reply is not proof that no offer reached the app. Read state, never resend automatically.
    try { await refresh(); } catch { state = 'browser'; status.textContent = text('pickerBrowser'); }
  }).finally(() => { busy = false; updateControls(); });
});
document.querySelector('#close')!.addEventListener('click', () => { window.close(); });
void refresh().then(() => { if (state === 'ready') search.focus(); }).catch(() => {
  state = 'expired'; status.textContent = text('pickerExpired'); updateControls();
});
