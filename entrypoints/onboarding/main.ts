import { browser } from 'wxt/browser';
import { applyTheme, localize, showStatus, text } from '../../src/ui';
import type { Settings } from '../../src/types';
import '../../assets/ui.css';
localize();
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const open = document.querySelector<HTMLButtonElement>('#open')!;
const error = document.querySelector<HTMLElement>('#error')!;
async function check(): Promise<void> {
  retry.disabled = open.disabled = true;
  try { const data = await browser.runtime.sendMessage({ type: 'popup-status' }) as { status: string; settings: Settings }; showStatus(data.status); applyTheme(data.settings); }
  catch { showStatus('error'); }
  finally { retry.disabled = open.disabled = false; }
}
retry.addEventListener('click', () => { error.textContent = ''; void check(); });
open.addEventListener('click', () => {
  retry.disabled = open.disabled = true; error.textContent = '';
  void (async () => {
    try { const reply = await browser.runtime.sendMessage({ type: 'open' }); if (!reply?.ok) error.textContent = text('popupOpenError'); }
    catch { error.textContent = text('popupOpenError'); }
    await check();
  })();
});
void check();
