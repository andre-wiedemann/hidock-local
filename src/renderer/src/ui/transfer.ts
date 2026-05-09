import { formatBytes, formatDuration } from '../util/format.js';

export function updateProgress(current: number, total: number, currentFileLabel: string | null = null): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  setText('progressFill', `${pct}%`);
  setStyle('progressFill', 'width', `${pct}%`);
  setText('progressPercent', `${pct}%`);
  setText('downloadedFiles', String(current));
  setText('totalFiles', String(total));
  if (currentFileLabel) setText('currentFile', currentFileLabel);
}

export function setSpeedDisplay(bytesPerSec: number): void {
  setText('transferSpeed', bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '—');
}

export function setEtaDisplay(seconds: number): void {
  setText('transferEta', formatDuration(seconds));
}

export function showTransferPanel(): void {
  const panel = document.getElementById('progressContainer');
  if (panel) panel.style.display = 'block';
}

export function setBatchControlsActive(active: boolean): void {
  setDisabled('downloadAllBtn', active);
  setDisabled('downloadSelectedBtn', active);
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement | null;
  if (stopBtn) {
    stopBtn.style.display = active ? 'inline-block' : 'none';
    stopBtn.disabled = false;
  }
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStyle(id: string, prop: string, value: string): void {
  const el = document.getElementById(id);
  if (el) (el.style as unknown as Record<string, string>)[prop] = value;
}

function setDisabled(id: string, disabled: boolean): void {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (el) el.disabled = disabled;
}
