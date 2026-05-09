// Model location helpers + catalog-aware listings used by the renderer.

import { app } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelInfo } from '../../shared/whisper.js';
import { MODEL_CATALOG } from './catalog.js';
import { isDownloading } from './download.js';

/**
 * Where ggml-*.bin model files live. Each model is stored as
 * `<dir>/ggml-<name>.bin`, e.g. ggml-base.en.bin or ggml-large-v3.bin.
 */
export function modelsDir(): string {
  return join(app.getPath('userData'), 'models');
}

/** Absolute path for a given model name. May or may not exist on disk. */
export function modelPath(name: string): string {
  return join(modelsDir(), `ggml-${name}.bin`);
}

export function isModelDownloaded(name: string): boolean {
  return existsSync(modelPath(name));
}

/**
 * Return all known models with their downloaded state. The list order
 * matches the catalog (smallest-to-largest, English variants first within
 * each tier) so the UI doesn't have to re-sort.
 */
export function listModels(): ModelInfo[] {
  return MODEL_CATALOG.map((entry) => {
    const downloaded = isModelDownloaded(entry.name);
    // If downloaded, prefer the actual on-disk size; otherwise use the
    // catalog's approximate size for pre-download UI hints.
    const size = downloaded
      ? safeStatSize(modelPath(entry.name)) ?? entry.sizeBytes
      : entry.sizeBytes;
    return {
      name: entry.name,
      displayName: entry.displayName,
      sizeBytes: size,
      downloaded
    };
  });
}

function safeStatSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * Delete a downloaded model file. No-op if it isn't downloaded or is
 * currently being downloaded (caller should cancel the download first).
 */
export async function deleteModel(name: string): Promise<void> {
  if (isDownloading(name)) {
    throw new Error(`Cannot delete ${name} while downloading. Cancel first.`);
  }
  if (!isModelDownloaded(name)) return;
  await unlink(modelPath(name));
}
