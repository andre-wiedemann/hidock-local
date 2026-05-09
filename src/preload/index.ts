// Renderer-facing API. Most of the renderer talks to WebUSB directly, so
// the preload bridge is intentionally narrow — it exposes only the
// privileged operations that need the main process (whisper transcription,
// platform metadata).

import { contextBridge, ipcRenderer } from 'electron';
import type {
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult
} from '../shared/whisper.js';

const PROGRESS_CHANNEL = 'whisper:progress';

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
  /**
   * Subscribe to progress events. Callback receives every TranscribeProgress
   * emitted by the main process; filter by `requestId` if multiple
   * transcriptions are in flight. Returns an unsubscribe function.
   */
  onProgress(callback: (p: TranscribeProgress) => void): () => void {
    const handler = (_event: unknown, payload: TranscribeProgress): void => callback(payload);
    ipcRenderer.on(PROGRESS_CHANNEL, handler);
    return () => ipcRenderer.off(PROGRESS_CHANNEL, handler);
  }
};

const api = {
  platform: process.platform,
  version: process.env['npm_package_version'] ?? '0.0.0',
  whisper: whisperApi
};

contextBridge.exposeInMainWorld('hidock', api);

export type HidockApi = typeof api;
