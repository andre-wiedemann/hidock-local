// Resolve the bundled whisper-cli binary path at runtime.
//
// In dev:           resources/whisper/<platform-arch>/whisper-cli
// In packaged app:  <app>/Contents/Resources/whisper/<platform-arch>/whisper-cli
//                   (electron-builder unpacks resources/ from the asar)

import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function platformArch(): string {
  return `${process.platform}-${process.arch}`;
}

function binaryName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

/** Absolute path to the whisper-cli binary, or null if it isn't bundled. */
export function findWhisperBinary(): string | null {
  const subpath = join('whisper', platformArch(), binaryName());

  // Packaged app: electron-builder copies our `resources/` dir into the
  // app bundle's resources directory.
  const packagedPath = join(process.resourcesPath, subpath);
  if (existsSync(packagedPath)) return packagedPath;

  // Dev: paths are relative to the project root.
  const devPath = join(app.getAppPath(), 'resources', subpath);
  if (existsSync(devPath)) return devPath;

  return null;
}
