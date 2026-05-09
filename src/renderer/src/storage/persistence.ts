// Three flavors of persistence:
//   1. localStorage:        savedFiles registry, file-list cache
//   2. IndexedDB:           FileSystemDirectoryHandle (only IDB can store these)
// All wrapped behind plain async functions.

const SAVED_FILES_KEY = 'hidock:downloaded';
const FILE_LIST_CACHE_KEY = 'hidock:fileList';
const DB_NAME = 'hidock-console';
const DB_VERSION = 1;
const STORE_NAME = 'state';

// ─── savedFiles (persistent set of "we already pulled this") ───────────

export interface SavedFile {
  size: number;
  savedAt: string;
}

export type SavedFileMap = Record<string, SavedFile>;

export function loadSavedFiles(): SavedFileMap {
  try {
    const raw = localStorage.getItem(SAVED_FILES_KEY);
    return raw ? (JSON.parse(raw) as SavedFileMap) : {};
  } catch {
    return {};
  }
}

export function persistSavedFiles(map: SavedFileMap): void {
  try {
    localStorage.setItem(SAVED_FILES_KEY, JSON.stringify(map));
  } catch {
    // Storage quota issues — non-fatal; we just won't remember next session.
  }
}

// ─── File-list cache (so the UI shows something before reconnect) ──────

export interface CachedFile {
  name: string;
  size: number;
}

export interface FileListCache {
  savedAt: string;
  files: CachedFile[];
}

export function loadFileListCache(): FileListCache | null {
  try {
    const raw = localStorage.getItem(FILE_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FileListCache;
    if (!parsed || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFileListCache(files: ReadonlyArray<{ name: string; size: number }>): void {
  try {
    const cache: FileListCache = {
      savedAt: new Date().toISOString(),
      files: files.map((f) => ({ name: f.name, size: f.size || 0 }))
    };
    localStorage.setItem(FILE_LIST_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to cache file list:', err);
  }
}

// ─── IndexedDB shim (FileSystemDirectoryHandle persistence) ────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function dbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
