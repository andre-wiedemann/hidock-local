import { getBatteryStatus, getStorageInfo } from '../usb/commands.js';
import { state } from '../state.js';
import { formatBytes } from '../util/format.js';
import { log } from './log.js';
import type { BatteryStatus } from '../usb/parsers.js';

function batterySigil(b: BatteryStatus): string {
  // Compact glyph reflecting state at a glance.
  if (b.status === 'charging') return '⚡';
  if (b.status === 'full') return '🔋';
  // 'idle' = on-battery; show a gradient of fullness.
  if (b.percent >= 80) return '🔋';
  if (b.percent >= 40) return '🪫';
  return '🪫';
}

function renderBattery(b: BatteryStatus): void {
  const text = document.getElementById('batteryInfoText');
  const fill = document.getElementById('batteryBarFill');
  const panel = document.getElementById('batteryInfo');
  if (!text || !fill || !panel) return;
  const volts = (b.voltageMicroV / 1_000_000).toFixed(2);
  text.textContent = `${batterySigil(b)} ${b.percent}% · ${volts}V · ${b.status}`;
  fill.style.width = `${b.percent}%`;
  fill.classList.toggle('warn', b.percent < 30 && b.status === 'idle');
  fill.classList.toggle('crit', b.percent < 15 && b.status === 'idle');
  panel.style.display = 'flex';
}

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

  // Battery is a separate IPC; if it fails we just don't update the
  // panel (last-known value persists, same pattern as storage info).
  try {
    const b = await getBatteryStatus(state.device);
    if (b) renderBattery(b);
  } catch (err) {
    console.warn('Battery status refresh failed:', err);
  }
}

export function hideStorageInfo(): void {
  const panel = document.getElementById('storageInfo');
  if (panel) panel.style.display = 'none';
  const bat = document.getElementById('batteryInfo');
  if (bat) bat.style.display = 'none';
}
