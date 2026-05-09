// IPC bridge for the whisper subsystem.
//
// Channels (handle = invokable; send = main → renderer event):
//   whisper:has-binary           handle → boolean
//   whisper:transcribe           handle → TranscribeResult
//   whisper:cancel               handle → void
//   whisper:list-models          handle → ModelInfo[]
//   whisper:download-model       handle → void   (resolves on finish)
//   whisper:cancel-download      handle → void
//   whisper:delete-model         handle → void
//   whisper:progress             send   ← TranscribeProgress
//   whisper:download-progress    send   ← ModelDownloadProgress

import { BrowserWindow, ipcMain } from 'electron';
import {
  ModelDownloadProgress,
  ModelInfo,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult
} from '../../shared/whisper.js';
import { findWhisperBinary } from './binary.js';
import { cancelDownload, downloadModel } from './download.js';
import { deleteModel, listModels } from './models.js';
import { cancelTranscribe, transcribe } from './transcribe.js';

const PROGRESS_CHANNEL = 'whisper:progress';
const DOWNLOAD_PROGRESS_CHANNEL = 'whisper:download-progress';

export function registerWhisperIpc(): void {
  ipcMain.handle('whisper:has-binary', (): boolean => {
    return findWhisperBinary() !== null;
  });

  ipcMain.handle(
    'whisper:transcribe',
    async (event, req: TranscribeRequest): Promise<TranscribeResult> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const emit = (p: TranscribeProgress): void => {
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

  ipcMain.handle('whisper:list-models', (): ModelInfo[] => {
    return listModels();
  });

  ipcMain.handle(
    'whisper:download-model',
    async (event, name: string): Promise<void> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const emit = (p: ModelDownloadProgress): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(DOWNLOAD_PROGRESS_CHANNEL, p);
        }
      };
      await downloadModel(name, emit);
    }
  );

  ipcMain.handle('whisper:cancel-download', (_event, name: string): void => {
    cancelDownload(name);
  });

  ipcMain.handle(
    'whisper:delete-model',
    async (_event, name: string): Promise<void> => {
      await deleteModel(name);
    }
  );
}
