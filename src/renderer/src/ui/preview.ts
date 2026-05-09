import { downloadFile } from '../usb/commands.js';
import { state } from '../state.js';
import { formatBytes } from '../util/format.js';
import { applyExtensionPreference } from '../util/filename.js';
import { log } from './log.js';
import { setEtaDisplay, setSpeedDisplay } from './transfer.js';
import { RecordingFile } from '../state.js';

export function isBatchInProgress(): boolean {
  const btn = document.getElementById('downloadAllBtn') as HTMLButtonElement | null;
  return !!btn && btn.disabled;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`;
}

function getMp3Pref(): boolean {
  return (document.getElementById('useMp3Ext') as HTMLInputElement | null)?.checked ?? true;
}

/**
 * Try to read the recording from disk first; fall back to pulling it
 * from the device. Skips the slow USB transfer when the file is already
 * saved locally, which is the common case for play-after-download.
 */
async function loadAudioBytes(file: RecordingFile): Promise<{ bytes: Uint8Array; source: 'disk' | 'device' } | null> {
  if (state.dirPath) {
    const saveName = applyExtensionPreference(file.name, getMp3Pref());
    const path = joinPath(state.dirPath, saveName);
    const buf = await window.hidock.fs.readBinaryFile(path);
    if (buf) return { bytes: new Uint8Array(buf), source: 'disk' };
  }
  if (!state.device) return null;
  log(`Preview: pulling ${file.name} from device…`, 'info');
  const bytes = await downloadFile(state.device, file.name);
  return { bytes, source: 'device' };
}

export async function previewFile(file: RecordingFile): Promise<void> {
  if (state.previewing) {
    log('Preview already in progress — finish or close first', 'warning');
    return;
  }
  if (isBatchInProgress()) {
    log('Cannot preview while a batch download is running', 'warning');
    return;
  }
  // We only need the device when the file isn't on disk; check that
  // upstream so the user-visible "connect first" message only appears
  // when it's actually true.

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
    const loaded = await loadAudioBytes(file);
    if (!loaded) {
      log('Preview needs either a saved copy or a connected device.', 'warning');
      closePreview();
      return;
    }
    const blob = new Blob([loaded.bytes as BlobPart], { type: 'audio/mpeg' });

    if (state.previewBlobUrl) URL.revokeObjectURL(state.previewBlobUrl);
    state.previewBlobUrl = URL.createObjectURL(blob);
    audioEl.src = state.previewBlobUrl;
    titleEl.textContent = file.name;

    audioEl.play().catch(() => {});
    log(
      `Preview ready (${loaded.source}): ${file.name} (${formatBytes(loaded.bytes.length)})`,
      'success'
    );
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
