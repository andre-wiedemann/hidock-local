// Save Target panel — manages the folder where downloaded recordings land.
//
// Path-based: the renderer holds an absolute path string in `state.dirPath`
// and persists it to localStorage. On every startup the path is read back,
// validated via the main-process `fs:path-exists` IPC, and re-activated
// automatically — no permission prompt or "Resume Access" click.
//
// The folder picker itself is Electron's native `dialog.showOpenDialog`
// (proxied through preload), so we get the OS-standard chooser.

import { state } from '../state.js';
import { persistSavedFiles } from '../storage/persistence.js';
import { log } from './log.js';

const PATH_STORAGE_KEY = 'hidock:dirPath';

function loadStoredPath(): string | null {
  try {
    return localStorage.getItem(PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistPath(path: string | null): void {
  try {
    if (path) localStorage.setItem(PATH_STORAGE_KEY, path);
    else localStorage.removeItem(PATH_STORAGE_KEY);
  } catch {
    // Storage disabled — non-fatal.
  }
}

function setActivePath(path: string): void {
  state.dirPath = path;
  persistPath(path);
  const target = document.getElementById('saveTarget');
  const pathEl = document.getElementById('saveTargetPath');
  target?.classList.add('set');
  target?.classList.remove('paused');
  if (pathEl) pathEl.textContent = `📁 ${path}`;
  setDisplay('clearFolderBtn', 'inline-block');
  setDisplay('zipFieldMaxSize', 'none');
  setDisplay('zipFieldPerZip', 'none');
  setDisplay('zipFieldAutoSave', 'none');
  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement | null;
  if (chooseBtn) chooseBtn.textContent = 'Change Folder…';
}

function setNoActivePath(): void {
  state.dirPath = null;
  persistPath(null);
  const target = document.getElementById('saveTarget');
  const pathEl = document.getElementById('saveTargetPath');
  target?.classList.remove('set');
  target?.classList.remove('paused');
  if (pathEl) {
    pathEl.textContent =
      'Browser downloads · click Choose Folder to stream files directly to disk';
  }
  setDisplay('clearFolderBtn', 'none');
  setDisplay('zipFieldMaxSize', '');
  setDisplay('zipFieldPerZip', '');
  setDisplay('zipFieldAutoSave', '');
  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement | null;
  if (chooseBtn) chooseBtn.textContent = 'Choose Folder…';
}

/** Restore the persisted path on startup if the folder still exists. */
export async function tryRestoreDirPath(): Promise<void> {
  const stored = loadStoredPath();
  if (!stored) return;
  try {
    const exists = await window.hidock.fs.pathExists(stored);
    if (exists) {
      setActivePath(stored);
      log(`Restored save folder: ${stored}`, 'info');
      await refreshSavedFromDisk();
    } else {
      // Folder was renamed or deleted — drop the stored path silently.
      persistPath(null);
    }
  } catch (err) {
    console.warn('Restore dir path failed:', err);
  }
}

export async function chooseDirectory(): Promise<void> {
  try {
    const chosen = await window.hidock.fs.chooseDirectory(state.dirPath ?? undefined);
    if (!chosen) return;
    setActivePath(chosen);
    log(`Save folder set: ${chosen}`, 'success');
    await refreshSavedFromDisk();
  } catch (err) {
    log(`Folder pick failed: ${(err as Error).message}`, 'error');
  }
}

export async function clearDirectoryChoice(): Promise<void> {
  setNoActivePath();
  log('Save folder cleared — falling back to browser-download path', 'info');
  await refreshSavedFromDisk();
}

/** Write a Blob (or its bytes) to the active save folder. */
export async function saveBlobToFolder(blob: Blob, filename: string): Promise<void> {
  if (!state.dirPath) throw new Error('No folder selected');
  const buffer = await blob.arrayBuffer();
  await window.hidock.fs.writeFile(state.dirPath, filename, buffer);
}

type SavedRowsRefresher = () => void;
let refreshSavedRowsFn: SavedRowsRefresher = () => {};

/** Caller in app.ts injects a function that updates "✓ Saved" badges + T-button state. */
export function setSavedRowsRefresher(fn: SavedRowsRefresher): void {
  refreshSavedRowsFn = fn;
}

/**
 * Reconcile `state.savedFiles` with what's actually on disk in the active
 * folder. Drops entries for files the user deleted in Finder; picks up
 * entries for files that appeared by other means (e.g. an earlier session
 * before localStorage was cleared, or files dragged into the folder).
 *
 * Called on:
 *   - app init (after the persisted dirPath is restored)
 *   - dirPath change (Choose Folder / Clear)
 *   - file-list reload
 *   - window focus (so deleting in Finder while the app is in background
 *     reflects the next time the user activates the window)
 */
export async function refreshSavedFromDisk(): Promise<void> {
  if (!state.dirPath) {
    // No folder set — clear any leftover entries; we no longer have a
    // disk to reconcile against.
    if (Object.keys(state.savedFiles).length > 0) {
      state.savedFiles = {};
      persistSavedFiles(state.savedFiles);
      refreshSavedRowsFn();
    }
    return;
  }
  try {
    const onDisk = await window.hidock.fs.listDir(state.dirPath);
    const onDiskSet = new Set(onDisk);

    let changed = false;
    for (const key of Object.keys(state.savedFiles)) {
      if (!onDiskSet.has(key)) {
        delete state.savedFiles[key];
        changed = true;
      }
    }
    for (const name of onDisk) {
      if (!state.savedFiles[name]) {
        state.savedFiles[name] = { size: 0, savedAt: '' };
        changed = true;
      }
    }
    if (changed) {
      persistSavedFiles(state.savedFiles);
      refreshSavedRowsFn();
    }
  } catch (err) {
    console.warn('Refresh saved-from-disk failed:', err);
  }
}

function setDisplay(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}
