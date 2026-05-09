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
  /**
   * Absolute path of the user's chosen save folder, or null if none. The
   * path is resolved by Electron's native dialog and persisted to
   * localStorage so it auto-activates on every startup — no permission
   * prompt or "Resume Access" dance required.
   */
  dirPath: string | null;
  savedFiles: SavedFileMap;
  stopRequested: boolean;
  previewing: boolean;
  previewBlobUrl: string | null;
  /** Index in `files` of the recording currently loaded in the mini-player, or null. */
  previewingFileIndex: number | null;
  /** True while the mini-player audio is actively playing (between play/pause). */
  previewIsPlaying: boolean;
  /** Index of last file checkbox the user clicked, for shift-range selection. */
  lastClickedFileIndex: number | null;
}

export const state: AppState = {
  device: null,
  files: [],
  dirPath: null,
  savedFiles: loadSavedFiles(),
  stopRequested: false,
  previewing: false,
  previewBlobUrl: null,
  previewingFileIndex: null,
  previewIsPlaying: false,
  lastClickedFileIndex: null
};
