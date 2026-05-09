// Stream a model file from Hugging Face into userData/models/.
//
// - Writes to <dest>.partial then rename — atomic against crashes.
// - Reports progress via callback every chunk (rate-limited to ~10 Hz to
//   avoid IPC spam on slow networks).
// - Cancellable via AbortController.
//
// Concurrent downloads of the same model are guarded by an in-memory map
// of active AbortControllers; calling downloadModel a second time while
// one is in flight cancels the first.

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ModelDownloadProgress } from '../../shared/whisper.js';
import { findEntry, modelUrl } from './catalog.js';
import { isModelDownloaded, modelPath, modelsDir } from './models.js';

type ProgressEmitter = (p: ModelDownloadProgress) => void;

const activeDownloads = new Map<string, AbortController>();

export function isDownloading(name: string): boolean {
  return activeDownloads.has(name);
}

export function cancelDownload(name: string): void {
  activeDownloads.get(name)?.abort();
}

export async function downloadModel(
  name: string,
  emit: ProgressEmitter
): Promise<string> {
  if (!findEntry(name)) {
    throw new Error(`Unknown model: ${name}`);
  }
  if (isModelDownloaded(name)) {
    return modelPath(name);
  }
  // Cancel any prior in-flight download of the same model.
  activeDownloads.get(name)?.abort();
  const controller = new AbortController();
  activeDownloads.set(name, controller);

  await mkdir(modelsDir(), { recursive: true });
  const dest = modelPath(name);
  const partial = `${dest}.partial`;

  // Drop any prior partial file — we don't currently support resumption.
  await unlink(partial).catch(() => {});

  try {
    const url = modelUrl(name);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    const totalHeader = response.headers.get('content-length');
    const total = totalHeader ? parseInt(totalHeader, 10) : 0;

    let received = 0;
    let lastEmit = 0;
    const nodeStream = Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>
    );
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastEmit >= 100 || received === total) {
        lastEmit = now;
        emit({
          name,
          bytesDownloaded: received,
          bytesTotal: total,
          percent: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0
        });
      }
    });

    await pipeline(nodeStream, createWriteStream(partial));

    // Sanity check size if we know what to expect.
    const stats = await stat(partial);
    if (total > 0 && stats.size !== total) {
      throw new Error(
        `Download size mismatch: got ${stats.size} bytes, expected ${total}`
      );
    }
    await rename(partial, dest);

    // Ensure final 100% emit.
    emit({ name, bytesDownloaded: stats.size, bytesTotal: stats.size, percent: 100 });
    return dest;
  } catch (err) {
    await unlink(partial).catch(() => {});
    throw err;
  } finally {
    activeDownloads.delete(name);
  }
}
