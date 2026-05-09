// Top-level download orchestration. Three entry points:
//
//   downloadSingle           — one file, used by Stop-aware retry button
//   downloadStreamToFolder   — multiple files, direct-to-disk via dirHandle
//   downloadAllOrZip         — multiple files, ZIP fallback when no dirHandle
//
// All three share the per-file core (`runSingle`) which calls into the USB
// commands layer and routes the resulting blob through the saved-files panel.

import JSZip from 'jszip';
import { state, RecordingFile } from './state.js';
import { downloadFile } from './usb/commands.js';
import { applyExtensionPreference } from './util/filename.js';
import { SpeedTracker } from './util/speed-tracker.js';
import { log } from './ui/log.js';
import {
  setBatchControlsActive,
  setEtaDisplay,
  setSpeedDisplay,
  showTransferPanel,
  updateProgress
} from './ui/transfer.js';
import { updateRow } from './ui/file-list.js';
import {
  clearSavedFilesPanel,
  presentSaveableBlob
} from './ui/saved-files-panel.js';
import { maybeAutoTranscribe } from './whisper/transcribe-flow.js';

function getMp3Pref(): boolean {
  return (document.getElementById('useMp3Ext') as HTMLInputElement | null)?.checked ?? true;
}

function getAutoSavePref(): boolean {
  return (document.getElementById('autoSave') as HTMLInputElement | null)?.checked ?? true;
}

function getSaveName(file: RecordingFile): string {
  return applyExtensionPreference(file.name, getMp3Pref());
}

interface ZipStatCells {
  zipsStat: HTMLElement | null;
  zipSize: HTMLElement | null;
}

function zipCells(): ZipStatCells {
  return {
    zipsStat: document.getElementById('zipsStatCell'),
    zipSize: document.getElementById('zipSizeStatCell')
  };
}

/** Pull a single file from the device, with progress wiring. */
async function pullBytes(file: RecordingFile): Promise<Uint8Array> {
  if (!state.device) throw new Error('Not connected');
  const tracker = new SpeedTracker();
  let lastDisplayAt = 0;

  return downloadFile(state.device, file.name, {
    shouldAbort: () => state.stopRequested,
    onProgress: ({ bytesReceived, chunkBytes }) => {
      tracker.record(chunkBytes);
      const now = performance.now();
      if (now - lastDisplayAt > 250) {
        lastDisplayAt = now;
        const bps = tracker.bytesPerSecond();
        setSpeedDisplay(bps);
        if (file.expectedSize && bps > 0) {
          const remaining = Math.max(0, file.expectedSize - bytesReceived);
          setEtaDisplay(remaining / bps);
        } else {
          setEtaDisplay(NaN);
        }
      }
    }
  });
}

/** Download one file directly (skips ZIP path even if more selected). */
export async function downloadSingle(file: RecordingFile): Promise<void> {
  if (!state.device) {
    log('Connect the device first', 'warning');
    return;
  }

  state.stopRequested = false;
  clearSavedFilesPanel();
  showTransferPanel();
  setBatchControlsActive(true);
  setSpeedDisplay(0);
  setEtaDisplay(NaN);

  // Hide ZIP-only stat cells.
  const { zipsStat, zipSize } = zipCells();
  if (zipsStat) zipsStat.style.display = 'none';
  if (zipSize) zipSize.style.display = 'none';

  updateProgress(0, 1, `Downloading: ${file.name}`);
  file.status = 'downloading';
  updateRow(file, 'downloading');

  try {
    log(`Downloading ${file.name}…`, 'info');
    const data = await pullBytes(file);
    const saveName = getSaveName(file);
    const mime = saveName.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
    const blob = new Blob([data as BlobPart], { type: mime });
    await presentSaveableBlob(blob, saveName, getAutoSavePref(), 'Recording');
    file.status = 'success';
    file.size = data.length;
    updateRow(file, 'success');
    log(`✓ ${file.name} (${(data.length / 1024).toFixed(1)} KB)`, 'success');
    updateProgress(1, 1, 'Complete!');
    maybeAutoTranscribe(file);
  } catch (err) {
    file.status = 'error';
    updateRow(file, 'error');
    log(`✗ ${file.name}: ${(err as Error).message}`, 'error');
  } finally {
    setBatchControlsActive(false);
    setSpeedDisplay(0);
    setEtaDisplay(NaN);
  }
}

/** Stream a list of files directly to the chosen folder, one at a time. */
export async function downloadStreamToFolder(filesToDownload: RecordingFile[]): Promise<void> {
  state.stopRequested = false;
  clearSavedFilesPanel();
  showTransferPanel();
  setBatchControlsActive(true);

  const { zipsStat, zipSize } = zipCells();
  if (zipsStat) zipsStat.style.display = 'none';
  if (zipSize) zipSize.style.display = 'none';

  let success = 0;
  let errors = 0;

  for (let i = 0; i < filesToDownload.length; i++) {
    if (state.stopRequested) {
      log('Download stopped by user', 'warning');
      break;
    }
    const file = filesToDownload[i];
    updateProgress(i, filesToDownload.length, `Downloading: ${file.name}`);
    updateRow(file, 'downloading');

    try {
      log(`Downloading ${file.name}…`, 'info');
      const data = await pullBytes(file);
      const saveName = getSaveName(file);
      const mime = saveName.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
      const blob = new Blob([data as BlobPart], { type: mime });
      await presentSaveableBlob(blob, saveName, true, 'Recording');
      file.status = 'success';
      file.size = data.length;
      updateRow(file, 'success');
      success++;
      log(`✓ ${file.name} (${(data.length / 1024).toFixed(1)} KB)`, 'success');
      maybeAutoTranscribe(file);
    } catch (err) {
      errors++;
      file.status = 'error';
      updateRow(file, 'error');
      log(`✗ ${file.name}: ${(err as Error).message}`, 'error');
    }
    await sleep(200);
  }

  updateProgress(filesToDownload.length, filesToDownload.length, 'Complete!');
  setSpeedDisplay(0);
  setEtaDisplay(NaN);
  log(
    `Stream complete: ${success} files saved, ${errors} failed`,
    errors > 0 ? 'warning' : 'success'
  );
  setBatchControlsActive(false);
}

/** Multi-file download with JSZip fallback when no folder is set. */
export async function downloadAllOrZip(filesToDownload: RecordingFile[]): Promise<void> {
  if (filesToDownload.length === 0) {
    log('No files to download', 'warning');
    return;
  }
  if (state.dirHandle) {
    await downloadStreamToFolder(filesToDownload);
    return;
  }
  if (filesToDownload.length === 1) {
    await downloadSingle(filesToDownload[0]);
    return;
  }

  const maxZipMb = parseInt(
    (document.getElementById('maxZipSize') as HTMLInputElement | null)?.value || '100',
    10
  );
  const filesPerZip = parseInt(
    (document.getElementById('filesPerZip') as HTMLInputElement | null)?.value || '20',
    10
  );
  const maxZipBytes = maxZipMb * 1024 * 1024;

  state.stopRequested = false;
  clearSavedFilesPanel();
  showTransferPanel();
  setBatchControlsActive(true);

  const { zipsStat, zipSize } = zipCells();
  if (zipsStat) zipsStat.style.display = '';
  if (zipSize) zipSize.style.display = '';

  let zipCounter = 0;
  let currentZip = new JSZip();
  let currentZipBytes = 0;
  let filesInCurrentZip = 0;
  let success = 0;
  let errors = 0;

  const flushZip = async (): Promise<void> => {
    if (currentZipBytes === 0) return;
    log('Generating ZIP…', 'info');
    document.getElementById('currentFile')!.textContent = 'Generating ZIP file…';
    try {
      const zipBlob = await currentZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 5 }
      });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      zipCounter++;
      const filename = `HiDock_Recordings_${ts}_part${zipCounter}.zip`;
      const fileCount = Object.keys(currentZip.files).length;
      await presentSaveableBlob(zipBlob, filename, getAutoSavePref(), 'ZIP archive', fileCount);
    } catch (err) {
      log(`Error creating ZIP: ${(err as Error).message}`, 'error');
    }
    currentZip = new JSZip();
    currentZipBytes = 0;
    filesInCurrentZip = 0;
  };

  for (let i = 0; i < filesToDownload.length; i++) {
    if (state.stopRequested) {
      log('Download stopped by user', 'warning');
      break;
    }
    const file = filesToDownload[i];
    updateProgress(i, filesToDownload.length, `Downloading: ${file.name}`);
    updateRow(file, 'downloading');

    try {
      log(`Downloading ${file.name}…`, 'info');
      const data = await pullBytes(file);

      if (
        (currentZipBytes + data.length > maxZipBytes ||
          filesInCurrentZip >= filesPerZip) &&
        filesInCurrentZip > 0
      ) {
        await flushZip();
      }

      currentZip.file(file.name, data);
      currentZipBytes += data.length;
      filesInCurrentZip++;
      success++;
      file.status = 'success';
      file.size = data.length;
      updateRow(file, 'success');
      log(`✓ ${file.name} (${(data.length / 1024).toFixed(1)} KB)`, 'success');

      const sizeEl = document.getElementById('currentZipSize');
      if (sizeEl) sizeEl.textContent = `${(currentZipBytes / 1024 / 1024).toFixed(1)} MB`;
      const countEl = document.getElementById('zipsCreated');
      if (countEl) countEl.textContent = String(zipCounter);
    } catch (err) {
      errors++;
      file.status = 'error';
      updateRow(file, 'error');
      log(`✗ ${file.name}: ${(err as Error).message}`, 'error');
    }
    await sleep(200);
  }

  if (filesInCurrentZip > 0) await flushZip();

  updateProgress(filesToDownload.length, filesToDownload.length, 'Complete!');
  log(
    `Download complete: ${success} files in ${zipCounter} ZIP(s), ${errors} failed`,
    errors > 0 ? 'warning' : 'success'
  );
  setBatchControlsActive(false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
