// Filesystem + dialog IPC for the renderer.
//
// The renderer used to manage save folders via FileSystemDirectoryHandle
// (Chromium's File System Access API), but that API requires the user to
// re-grant permission via a button click after every restart. In Electron
// we have full Node fs access in the main process, so we trade the
// browser-native handle for a plain absolute path that the renderer
// persists to localStorage and we use to write files.
//
// Channels:
//   dialog:choose-directory     handle → string | null
//   fs:write-file               handle → void
//   fs:path-exists              handle → boolean
//   fs:list-dir                 handle → string[]   (for saved-file scan)

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface ChooseDirArgs {
  defaultPath?: string;
}

export function registerFileIpc(): void {
  ipcMain.handle(
    'dialog:choose-directory',
    async (event, args: ChooseDirArgs = {}): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win!, {
        title: 'Choose Save Folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: args.defaultPath
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    'fs:write-file',
    async (
      _event,
      args: { dirPath: string; fileName: string; bytes: ArrayBuffer }
    ): Promise<void> => {
      // Refuse paths that look traversal-y. The dirPath was authorized by
      // the user via the dialog; the fileName came from the device's own
      // listing or a renaming pass, but defense-in-depth is cheap.
      if (args.fileName.includes('/') || args.fileName.includes('\\') || args.fileName.includes('..')) {
        throw new Error(`Refusing suspicious filename: ${args.fileName}`);
      }
      await mkdir(args.dirPath, { recursive: true });
      const fullPath = join(args.dirPath, args.fileName);
      await writeFile(fullPath, Buffer.from(args.bytes));
    }
  );

  ipcMain.handle('fs:path-exists', (_event, path: string): boolean => {
    if (!path) return false;
    try {
      // statSync rather than existsSync so we can distinguish "exists but
      // not a directory" if needed in the future.
      return statSync(path).isDirectory() || existsSync(path);
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:list-dir', async (_event, dirPath: string): Promise<string[]> => {
    if (!dirPath || !existsSync(dirPath)) return [];
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  });

  ipcMain.handle('fs:read-text-file', async (_event, path: string): Promise<string> => {
    if (!path || !existsSync(path)) return '';
    return readFile(path, 'utf-8');
  });
}
