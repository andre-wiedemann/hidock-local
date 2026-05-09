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
  } catch (err) {
    log(`Folder pick failed: ${(err as Error).message}`, 'error');
  }
}

export async function clearDirectoryChoice(): Promise<void> {
  setNoActivePath();
  log('Save folder cleared — falling back to browser-download path', 'info');
}

/** Write a Blob (or its bytes) to the active save folder. */
export async function saveBlobToFolder(blob: Blob, filename: string): Promise<void> {
  if (!state.dirPath) throw new Error('No folder selected');
  const buffer = await blob.arrayBuffer();
  await window.hidock.fs.writeFile(state.dirPath, filename, buffer);
}

function setDisplay(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}
