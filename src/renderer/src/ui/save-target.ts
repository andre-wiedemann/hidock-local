// Manages the "Save Target" panel and the directory-picker flow.
//
// Three states:
//   - choose:   no folder selected, browser-download fallback in effect
//   - set:      folder is active, files stream straight to disk
//   - paused:   handle exists from a prior session but needs re-grant

import { state } from '../state.js';
import { dbDel, dbGet, dbSet } from '../storage/persistence.js';
import { log } from './log.js';

const HANDLE_KEY = 'dirHandle';

interface PermissibleHandle extends FileSystemDirectoryHandle {
  queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export function setActiveDirHandle(handle: FileSystemDirectoryHandle): void {
  state.dirHandle = handle;
  const target = document.getElementById('saveTarget')!;
  const path = document.getElementById('saveTargetPath')!;
  target.classList.add('set');
  target.classList.remove('paused');
  path.textContent = `📁 ${handle.name} · streaming each file directly to disk`;

  setDisplay('clearFolderBtn', 'inline-block');
  setDisplay('zipFieldMaxSize', 'none');
  setDisplay('zipFieldPerZip', 'none');
  setDisplay('zipFieldAutoSave', 'none');

  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement;
  chooseBtn.textContent = 'Change Folder…';
  chooseBtn.dataset['mode'] = 'change';
}

export function clearActiveDirHandle(): void {
  state.dirHandle = null;
  const target = document.getElementById('saveTarget')!;
  const path = document.getElementById('saveTargetPath')!;
  target.classList.remove('set');
  target.classList.remove('paused');
  path.textContent =
    'Browser downloads · click Choose Folder to stream files directly to disk';

  setDisplay('clearFolderBtn', 'none');
  setDisplay('zipFieldMaxSize', '');
  setDisplay('zipFieldPerZip', '');
  setDisplay('zipFieldAutoSave', '');

  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement;
  chooseBtn.textContent = 'Choose Folder…';
  chooseBtn.dataset['mode'] = 'choose';
}

export function showResumeBanner(handle: FileSystemDirectoryHandle): void {
  state.dirHandle = null;
  const target = document.getElementById('saveTarget')!;
  const path = document.getElementById('saveTargetPath')!;
  target.classList.add('paused');
  target.classList.remove('set');
  path.textContent = `⏸ ${handle.name} (saved from previous session — click to resume)`;
  setDisplay('clearFolderBtn', 'inline-block');

  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement;
  chooseBtn.textContent = 'Resume Access';
  chooseBtn.dataset['mode'] = 'resume';
}

/** Restore folder access on page load if the user previously chose one. */
export async function tryRestoreDirHandle(): Promise<void> {
  try {
    const stored = await dbGet<PermissibleHandle>(HANDLE_KEY);
    if (!stored || typeof stored.queryPermission !== 'function') return;
    const perm = await stored.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      setActiveDirHandle(stored);
      log(`Restored folder access: ${stored.name}`, 'info');
    } else if (perm === 'prompt') {
      showResumeBanner(stored);
    } else {
      await dbDel(HANDLE_KEY);
    }
  } catch (err) {
    console.warn('Restore dir handle failed:', err);
  }
}

export async function chooseDirectory(): Promise<void> {
  if (!('showDirectoryPicker' in window)) {
    log('showDirectoryPicker not available — falling back to ZIP downloads', 'warning');
    return;
  }
  const chooseBtn = document.getElementById('chooseFolderBtn') as HTMLButtonElement;
  const mode = chooseBtn.dataset['mode'] || 'choose';

  if (mode === 'resume') {
    try {
      const stored = await dbGet<PermissibleHandle>(HANDLE_KEY);
      if (stored) {
        const perm = await stored.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          setActiveDirHandle(stored);
          log(`Resumed folder: ${stored.name}`, 'success');
          return;
        }
        log('Permission denied — pick a different folder', 'warning');
      }
    } catch (err) {
      log(`Resume failed: ${(err as Error).message} — pick a different folder`, 'warning');
    }
    // Fall through to picker.
  }

  try {
    const handle = await (window as unknown as {
      showDirectoryPicker(opts: { mode: 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: 'readwrite' });
    await dbSet(HANDLE_KEY, handle).catch((e) => console.warn('persist failed:', e));
    setActiveDirHandle(handle);
    log(`Folder selected: ${handle.name}`, 'success');
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      log(`Folder pick failed: ${(err as Error).message}`, 'error');
    }
  }
}

export async function clearDirectoryChoice(): Promise<void> {
  await dbDel(HANDLE_KEY).catch((e) => console.warn('dbDel failed:', e));
  clearActiveDirHandle();
  log('Folder cleared — falling back to ZIP/browser-download', 'info');
}

/** Write a blob to the active dir-handle. Throws if no folder is set. */
export async function saveBlobToFolder(blob: Blob, filename: string): Promise<void> {
  if (!state.dirHandle) throw new Error('No folder selected');
  const fileHandle = await state.dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function setDisplay(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}
