// Model location helpers. The full download flow lands in T2; this module
// exists so transcribe.ts can resolve a model name to an absolute path
// without growing a circular dependency once T2 fills it in.

import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
