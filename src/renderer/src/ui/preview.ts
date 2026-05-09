import { downloadFile } from '../usb/commands.js';
import { state } from '../state.js';
import { formatBytes } from '../util/format.js';
import { log } from './log.js';
import { setEtaDisplay, setSpeedDisplay } from './transfer.js';
import { RecordingFile } from '../state.js';

export function isBatchInProgress(): boolean {
  const btn = document.getElementById('downloadAllBtn') as HTMLButtonElement | null;
  return !!btn && btn.disabled;
}

export async function previewFile(file: RecordingFile): Promise<void> {
  if (!state.device) {
    log('Connect the device first', 'warning');
    return;
  }
  if (state.previewing) {
    log('Preview already in progress — finish or close first', 'warning');
    return;
  }
  if (isBatchInProgress()) {
    log('Cannot preview while a batch download is running', 'warning');
    return;
  }

  state.previewing = true;
  const playerEl = document.getElementById('miniPlayer')!;
  const titleEl = document.getElementById('miniPlayerTitle')!;
  const audioEl = document.getElementById('miniPlayerAudio') as HTMLAudioElement;

  const idx = state.files.indexOf(file);
  const rows = document.querySelectorAll('.file-item');
  const playBtn = idx >= 0 ? rows[idx]?.querySelector('.play-btn') as HTMLButtonElement | null : null;

  titleEl.textContent = `↓ ${file.name}`;
  playerEl.classList.add('active');
  if (playBtn) {
    playBtn.classList.add('loading');
    playBtn.textContent = '…';
  }

  try {
    log(`Preview: pulling ${file.name} from device…`, 'info');
    const data = await downloadFile(state.device, file.name);
    const blob = new Blob([data as BlobPart], { type: 'audio/mpeg' });

    if (state.previewBlobUrl) URL.revokeObjectURL(state.previewBlobUrl);
    state.previewBlobUrl = URL.createObjectURL(blob);
    audioEl.src = state.previewBlobUrl;
    titleEl.textContent = file.name;

    audioEl.play().catch(() => {});
    log(`Preview ready: ${file.name} (${formatBytes(data.length)})`, 'success');
  } catch (err) {
    log(`Preview failed: ${(err as Error).message}`, 'error');
    closePreview();
  } finally {
    state.previewing = false;
    if (playBtn) {
      playBtn.classList.remove('loading');
      playBtn.textContent = '▶';
    }
    setSpeedDisplay(0);
    setEtaDisplay(NaN);
  }
}

export function closePreview(): void {
  const playerEl = document.getElementById('miniPlayer');
  const audioEl = document.getElementById('miniPlayerAudio') as HTMLAudioElement | null;
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      // Ignore.
    }
    audioEl.removeAttribute('src');
    audioEl.load();
  }
  playerEl?.classList.remove('active');
  if (state.previewBlobUrl) {
    URL.revokeObjectURL(state.previewBlobUrl);
    state.previewBlobUrl = null;
  }
}

export function wirePreviewClose(): void {
  document.getElementById('miniPlayerClose')?.addEventListener('click', closePreview);
}
