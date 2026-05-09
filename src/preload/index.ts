// Renderer-facing API. Most of the renderer talks to WebUSB directly, so
// the preload bridge is intentionally narrow — it exposes only the
// privileged operations that need the main process (whisper transcription,
// platform metadata).

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ModelDownloadProgress,
  ModelInfo,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult
} from '../shared/whisper.js';

const PROGRESS_CHANNEL = 'whisper:progress';
const DOWNLOAD_PROGRESS_CHANNEL = 'whisper:download-progress';

const whisperApi = {
  hasBinary(): Promise<boolean> {
    return ipcRenderer.invoke('whisper:has-binary');
  },
  transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    return ipcRenderer.invoke('whisper:transcribe', req);
  },
  cancel(requestId: string): Promise<void> {
    return ipcRenderer.invoke('whisper:cancel', requestId);
  },
  listModels(): Promise<ModelInfo[]> {
    return ipcRenderer.invoke('whisper:list-models');
  },
  downloadModel(name: string): Promise<void> {
    return ipcRenderer.invoke('whisper:download-model', name);
  },
  cancelDownload(name: string): Promise<void> {
    return ipcRenderer.invoke('whisper:cancel-download', name);
  },
  deleteModel(name: string): Promise<void> {
    return ipcRenderer.invoke('whisper:delete-model', name);
  },
  /** Subscribe to transcription progress events. */
  onProgress(callback: (p: TranscribeProgress) => void): () => void {
    const handler = (_event: unknown, payload: TranscribeProgress): void => callback(payload);
    ipcRenderer.on(PROGRESS_CHANNEL, handler);
    return () => ipcRenderer.off(PROGRESS_CHANNEL, handler);
  },
  /** Subscribe to model-download progress events. */
  onDownloadProgress(callback: (p: ModelDownloadProgress) => void): () => void {
    const handler = (_event: unknown, payload: ModelDownloadProgress): void => callback(payload);
    ipcRenderer.on(DOWNLOAD_PROGRESS_CHANNEL, handler);
    return () => ipcRenderer.off(DOWNLOAD_PROGRESS_CHANNEL, handler);
  }
};

const api = {
  platform: process.platform,
  version: process.env['npm_package_version'] ?? '0.0.0',
  /**
   * Resolve an absolute filesystem path for a File obtained from the
   * renderer (e.g. via `dirHandle.getFileHandle(name).then(h => h.getFile())`).
   * Required to hand the file to the main-process whisper pipeline since
   * IPC can't carry FileSystemFileHandle objects.
   */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  whisper: whisperApi
};

contextBridge.exposeInMainWorld('hidock', api);

export type HidockApi = typeof api;
