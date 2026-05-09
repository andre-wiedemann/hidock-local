// Typed accessor for the preload-exposed Whisper API.
//
// The contextBridge in src/preload/index.ts exposes the same shape as
// `WhisperApi` from src/shared/whisper.ts — this module just declares the
// global so the rest of the renderer can use it with autocomplete.

import type { WhisperApi } from '../../../shared/whisper.js';

interface FsApi {
  chooseDirectory(defaultPath?: string): Promise<string | null>;
  writeFile(dirPath: string, fileName: string, bytes: ArrayBuffer): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  listDir(dirPath: string): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
}

interface HidockGlobal {
  platform: string;
  version: string;
  /** Resolve a File (from FileSystemFileHandle) to an absolute disk path. */
  getPathForFile(file: File): string;
  fs: FsApi;
  whisper: WhisperApi;
}

declare global {
  interface Window {
    hidock: HidockGlobal;
  }
}

export function whisperApi(): WhisperApi {
  return window.hidock.whisper;
}
