// IPC bridge for the whisper subsystem.
//
// Channels:
//   whisper:transcribe          (handle) → TranscribeResult
//   whisper:cancel              (handle) → void
//   whisper:has-binary          (handle) → boolean
//   whisper:progress            (send)   ← TranscribeProgress

import { BrowserWindow, ipcMain } from 'electron';
import {
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult
} from '../../shared/whisper.js';
import { findWhisperBinary } from './binary.js';
import { cancelTranscribe, transcribe } from './transcribe.js';

const PROGRESS_CHANNEL = 'whisper:progress';

export function registerWhisperIpc(): void {
  ipcMain.handle('whisper:has-binary', (): boolean => {
    return findWhisperBinary() !== null;
  });

  ipcMain.handle(
    'whisper:transcribe',
    async (event, req: TranscribeRequest): Promise<TranscribeResult> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const emit = (p: TranscribeProgress): void => {
        // Only the originating window cares — broadcasts would cause
        // duplicate progress in any future multi-window layout.
        if (win && !win.isDestroyed()) {
          win.webContents.send(PROGRESS_CHANNEL, p);
        }
      };
      return transcribe(req, emit);
    }
  );

  ipcMain.handle('whisper:cancel', (_event, requestId: string): void => {
    cancelTranscribe(requestId);
  });
}
