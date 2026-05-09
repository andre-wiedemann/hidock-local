// Single source of truth for renderer state. Passed by reference to UI
// modules — they mutate `files`, the file-list panel re-reads, etc.

import { loadSavedFiles, SavedFileMap } from './storage/persistence.js';

export type FileStatus = 'pending' | 'downloading' | 'success' | 'error';

export interface RecordingFile {
  name: string;
  status: FileStatus;
  size: number;
  expectedSize: number;
  selected: boolean;
}

export interface AppState {
  device: USBDevice | null;
  files: RecordingFile[];
  dirHandle: FileSystemDirectoryHandle | null;
  savedFiles: SavedFileMap;
  stopRequested: boolean;
  previewing: boolean;
  previewBlobUrl: string | null;
  /** Index of last file checkbox the user clicked, for shift-range selection. */
  lastClickedFileIndex: number | null;
}

export const state: AppState = {
  device: null,
  files: [],
  dirHandle: null,
  savedFiles: loadSavedFiles(),
  stopRequested: false,
  previewing: false,
  previewBlobUrl: null,
  lastClickedFileIndex: null
};
