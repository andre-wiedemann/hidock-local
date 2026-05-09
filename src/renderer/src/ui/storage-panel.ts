import { getStorageInfo } from '../usb/commands.js';
import { state } from '../state.js';
import { formatBytes } from '../util/format.js';
import { log } from './log.js';

export async function refreshStoragePanel(): Promise<void> {
  if (!state.device) return;
  try {
    const result = await getStorageInfo(state.device);
    if (!result) {
      log('Storage info: no response (keeping previous value)', 'warning');
      return;
    }
    const { usedBytes, totalBytes } = result;
    const pct = Math.min(100, (usedBytes / totalBytes) * 100);
    const fill = document.getElementById('storageBarFill');
    if (fill) {
      fill.style.width = `${pct.toFixed(1)}%`;
      fill.classList.toggle('warn', pct >= 75 && pct < 90);
      fill.classList.toggle('crit', pct >= 90);
    }
    const text = document.getElementById('storageInfoText');
    if (text) {
      text.textContent = `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} · ${pct.toFixed(0)}% used`;
    }
    const panel = document.getElementById('storageInfo');
    if (panel) panel.style.display = 'flex';
  } catch (err) {
    console.warn('Storage info refresh failed:', err);
  }
}

export function hideStorageInfo(): void {
  const panel = document.getElementById('storageInfo');
  if (panel) panel.style.display = 'none';
}
