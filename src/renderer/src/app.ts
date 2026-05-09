// Top-level wiring. Connect/disconnect buttons, file-list controls, batch
// download, settings autosave, auto-reconnect — all hooked together here.
//
// This module owns the "what happens when you click X" logic but defers the
// actual work (USB, persistence, DOM mutation) to its dedicated modules.

import { state } from './state.js';
import { listFiles } from './usb/commands.js';
import {
  closeDevice,
  findPairedDevice,
  isWebUsbAvailable,
  openAndClaim,
  requestDevice
} from './usb/transport.js';
import {
  loadFileListCache,
  saveFileListCache
} from './storage/persistence.js';
import {
  applySettings,
  wireSettingsAutosave
} from './storage/settings.js';
import {
  setConnectedUi,
  setConnectionError,
  setDisconnectedUi
} from './ui/connection.js';
import {
  applyFilter,
  applySkipSavedToggle,
  refreshAllPlayingIndicators,
  refreshAllSavedStates,
  refreshAllTranscribeButtons,
  renderFileList,
  setDownloadHandler,
  setRetryHandler,
  setVisibleSelected
} from './ui/file-list.js';
import { wireLogControls, log } from './ui/log.js';
import {
  chooseDirectory,
  clearDirectoryChoice,
  refreshSavedFromDisk,
  setSavedRowsRefresher,
  tryRestoreDirPath
} from './ui/save-target.js';
import { refreshStoragePanel } from './ui/storage-panel.js';
import { onPreviewStateChange, wirePreviewClose } from './ui/preview.js';
import { wireCollapsible } from './ui/collapsible.js';
import {
  downloadAllOrZip,
  downloadSingle
} from './downloader.js';
import { initWhisperPanel } from './whisper/settings-panel.js';
import { subscribe as subscribeWhisper } from './whisper/store.js';
import { setDownloadFn, transcribeFile } from './whisper/transcribe-flow.js';
import { getCurrentTranscriptFile } from './whisper/transcript-panel.js';
import { HIDOCK_P1_PRODUCT_ID, HIDOCK_P1_VENDOR_ID } from '../../shared/types.js';

async function loadFileListLive(silent = false): Promise<void> {
  if (!state.device) {
    if (!silent) log('Connect the device first', 'warning');
    return;
  }
  try {
    if (!silent) log('Getting file list…', 'info');
    state.files = [];

    // USB-first ordering: refresh storage + list files immediately to
    // match the standalone HTML's exact sequence. The disk scan
    // (refreshSavedFromDisk) used to run here too, but its IPC roundtrip
    // added a ~100 ms gap between connect and the first USB command —
    // long enough on this firmware to drop us into the truncated
    // "warm" response state. We do that scan AFTER the file list now.
    await refreshStoragePanel();

    const entries = await listFiles(state.device);
    if (entries.length === 0) {
      log('No files found', 'warning');
      return;
    }

    state.files = entries.map((e) => ({
      name: e.name,
      status: 'pending' as const,
      size: e.size,
      expectedSize: e.size,
      selected: true
    }));
    log(`Found ${state.files.length} files`, 'success');

    // Sort latest first using the timestamp embedded in the filename.
    // (parseFileListResponse already returns this order, but re-sorting is
    // cheap and keeps the contract local.)
    sortFilesLatestFirst();

    renderFileList();
    saveFileListCache(state.files);

    // Now that the USB sequence is done, reconcile saved-state with
    // disk. This was previously called BEFORE the USB calls and the
    // 100 ms IPC delay was disrupting the device's response window.
    await refreshSavedFromDisk();
  } catch (err) {
    log(`Error listing files: ${(err as Error).message}`, 'error');
  }
}

function sortFilesLatestFirst(): void {
  // The names embed the timestamp; lexicographic sort on the embedded
  // YYYYMMDDHHMMSS yields the right order. parsers.ts already does this.
  // Re-applying here is cheap insurance against future reorderings.
  state.files.sort((a, b) => b.name.localeCompare(a.name));
}

function restoreCachedFileList(): boolean {
  const cache = loadFileListCache();
  if (!cache || !cache.files.length) return false;
  state.files = cache.files.map((f) => ({
    name: f.name,
    size: f.size || 0,
    expectedSize: f.size || 0,
    status: 'pending' as const,
    selected: true
  }));
  const ageSec = (Date.now() - new Date(cache.savedAt).getTime()) / 1000;
  const ageLabel =
    ageSec < 60
      ? 'CACHED · JUST NOW'
      : ageSec < 3600
        ? `CACHED · ${Math.round(ageSec / 60)}m AGO`
        : ageSec < 86400
          ? `CACHED · ${Math.round(ageSec / 3600)}h AGO`
          : `CACHED · ${Math.round(ageSec / 86400)}d AGO`;
  renderFileList(ageLabel);
  document.getElementById('downloadSection')!.style.display = 'block';
  return true;
}

async function connectDevice(usbDevice: USBDevice): Promise<void> {
  state.device = usbDevice;
  await openAndClaim(usbDevice);
  setConnectedUi();
  log('Device connected', 'success');
  // Settle delay — auto-reconnect can leave stale data on the IN endpoint
  // and racing the device's response queue causes empty file-list reads.
  setTimeout(() => loadFileListLive(), 200);
}

function wireConnectionButtons(): void {
  document.getElementById('connectBtn')!.addEventListener('click', async () => {
    try {
      log('Requesting USB device…', 'info');
      const dev = await requestDevice();
      await connectDevice(dev);
    } catch (err) {
      setConnectionError((err as Error).message);
    }
  });

  document.getElementById('disconnectBtn')!.addEventListener('click', async () => {
    if (!state.device) return;
    await closeDevice(state.device);
    setDisconnectedUi('Disconnected');
  });
}

function wireFileListControls(): void {
  document.getElementById('listFilesBtn')!.addEventListener('click', () => loadFileListLive());

  document.getElementById('selectAllBtn')!.addEventListener('click', () => setVisibleSelected(true));
  document.getElementById('deselectAllBtn')!.addEventListener('click', () => setVisibleSelected(false));

  document.getElementById('searchInput')!.addEventListener('input', applyFilter);

  document.getElementById('skipSavedToggle')!.addEventListener('change', (e) => {
    const skip = (e.target as HTMLInputElement).checked;
    applySkipSavedToggle(skip);
  });

  // Cmd/Ctrl+A inside the file list selects all visible.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return;
    const fl = document.getElementById('fileList');
    if (!fl || fl.style.display === 'none') return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    if (tag === 'input') {
      const inp = t as HTMLInputElement;
      if (inp.type === 'text' || inp.type === 'number' || inp.type === 'search') return;
    }
    if (tag === 'textarea') return;
    e.preventDefault();
    setVisibleSelected(true);
  });

  // Per-row retry + download buttons both call downloadSingle. The
  // transcribe flow uses the same fn for its auto-download-on-demand
  // path; injected here to avoid a circular import between downloader.ts
  // and whisper/transcribe-flow.ts.
  setRetryHandler((file) => downloadSingle(file));
  setDownloadHandler((file) => downloadSingle(file));
  setDownloadFn((file) => downloadSingle(file));
}

function wireDownloadButtons(): void {
  document.getElementById('downloadAllBtn')!.addEventListener('click', () => {
    const skip = (document.getElementById('skipSavedToggle') as HTMLInputElement | null)?.checked ?? false;
    let toDownload = state.files;
    if (skip) toDownload = toDownload.filter((f) => !state.savedFiles[applyExt(f.name)]);
    downloadAllOrZip(toDownload);
  });

  document.getElementById('downloadSelectedBtn')!.addEventListener('click', () => {
    const skip = (document.getElementById('skipSavedToggle') as HTMLInputElement | null)?.checked ?? false;
    let toDownload = state.files.filter((f) => f.selected);
    if (skip) toDownload = toDownload.filter((f) => !state.savedFiles[applyExt(f.name)]);
    downloadAllOrZip(toDownload);
  });

  document.getElementById('stopBtn')!.addEventListener('click', () => {
    state.stopRequested = true;
    (document.getElementById('stopBtn') as HTMLButtonElement).disabled = true;
  });
}

function applyExt(name: string): string {
  const useMp3 = (document.getElementById('useMp3Ext') as HTMLInputElement | null)?.checked ?? true;
  return useMp3 ? name.replace(/\.hda$/i, '.mp3') : name;
}

function wireSaveTargetButtons(): void {
  document.getElementById('chooseFolderBtn')!.addEventListener('click', chooseDirectory);
  document.getElementById('clearFolderBtn')!.addEventListener('click', clearDirectoryChoice);
  // The native folder picker is always available in Electron — no need to
  // hide the Choose Folder button (the standalone HTML's browser-fallback
  // case doesn't apply here).
}

function wireUsbLifecycleEvents(): void {
  if (!isWebUsbAvailable()) return;
  navigator.usb.addEventListener('disconnect', (event: USBConnectionEvent) => {
    if (
      event.device.vendorId === HIDOCK_P1_VENDOR_ID &&
      event.device.productId === HIDOCK_P1_PRODUCT_ID
    ) {
      log('Device disconnected (cable removed)', 'warning');
      state.stopRequested = true;
      setDisconnectedUi('Device disconnected');
    }
  });
  navigator.usb.addEventListener('connect', async (event: USBConnectionEvent) => {
    if (state.device) return;
    if (
      event.device.vendorId === HIDOCK_P1_VENDOR_ID &&
      event.device.productId === HIDOCK_P1_PRODUCT_ID
    ) {
      log('HiDock plugged in — reconnecting…', 'info');
      try {
        await connectDevice(event.device);
      } catch (err) {
        log(`Reconnect failed: ${(err as Error).message}`, 'error');
      }
    }
  });
}

async function tryAutoReconnect(): Promise<void> {
  if (!isWebUsbAvailable()) return;
  try {
    const paired = await findPairedDevice();
    if (paired) {
      log('Found previously paired HiDock — auto-reconnecting…', 'info');
      await connectDevice(paired);
    }
  } catch (err) {
    log(`Auto-reconnect skipped: ${(err as Error).message}`, 'warning');
  }
}

export async function init(): Promise<void> {
  if (!isWebUsbAvailable()) {
    const status = document.getElementById('connectionStatus');
    if (status) {
      status.textContent = 'WebUSB not supported. Use Chrome/Edge/Electron.';
      status.className = 'status error';
    }
    (document.getElementById('connectBtn') as HTMLButtonElement | null)?.setAttribute('disabled', 'true');
    return;
  }

  applySettings();
  wireSettingsAutosave();
  wireLogControls();
  wireConnectionButtons();
  wireFileListControls();
  wireDownloadButtons();
  wireSaveTargetButtons();
  wirePreviewClose();
  wireUsbLifecycleEvents();
  // Config panel collapses to free vertical space once the user has set
  // their preferences. Default expanded — most users tweak something on
  // first run.
  wireCollapsible({
    panelId: 'configPanel',
    headerId: 'configPanelHeader',
    storageKey: 'hidock:config:panelCollapsed',
    defaultCollapsed: false
  });
  // Transcript panel — hidden until the first transcription, then
  // collapsible. Default expanded so the user immediately sees the
  // result; persists their choice afterward.
  wireCollapsible({
    panelId: 'transcriptPanel',
    headerId: 'transcriptPanelHeader',
    storageKey: 'hidock:transcript:panelCollapsed',
    defaultCollapsed: false
  });
  // Re-transcribe button — re-enqueues whatever recording is currently
  // displayed in the transcript panel. Useful after switching to a
  // better model or hitting an empty/garbled result.
  document.getElementById('reTranscribeBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const file = getCurrentTranscriptFile();
    if (file) transcribeFile(file);
  });

  // Cached list shows immediately, even pre-connect.
  restoreCachedFileList();
  if ((document.getElementById('searchInput') as HTMLInputElement | null)?.value) {
    applyFilter();
  }

  // Path-based folder persistence — auto-restores the last chosen folder
  // on every startup without requiring a permission re-grant.
  setSavedRowsRefresher(refreshAllSavedStates);
  await tryRestoreDirPath();

  // If the user deletes a saved recording in Finder while the app is in
  // background, reconcile next time the window comes back to focus.
  window.addEventListener('focus', () => {
    refreshSavedFromDisk().catch((err) => {
      console.warn('focus refresh failed:', err);
    });
  });

  // Whisper panel mounts independently of USB state — the user can download
  // a model while the device is unplugged. Errors here shouldn't abort init.
  initWhisperPanel().catch((err) => {
    console.error('Whisper panel init failed:', err);
  });

  // When the default model changes (download finishes, user switches
  // default, model is deleted), refresh every visible T button so users
  // don't have to re-list files to see them enable.
  subscribeWhisper(() => refreshAllTranscribeButtons());

  // Sync per-row play indicators whenever the mini-player starts, pauses,
  // resumes, or closes — including pause/play triggered from the
  // mini-player's own controls.
  onPreviewStateChange(refreshAllPlayingIndicators);

  // Auto-reconnect runs last so the UI is fully wired by the time the device
  // call returns.
  tryAutoReconnect();
}
