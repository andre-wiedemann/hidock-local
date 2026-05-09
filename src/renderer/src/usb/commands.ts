import { HIDOCK_P1_IN_ENDPOINT, HIDOCK_P1_OUT_ENDPOINT, PROTOCOL_MAGIC } from '../../../shared/types.js';
import {
  CMD_GROUP_STORAGE,
  CMD_GROUP_SYSTEM,
  ClaimedDevice,
  SUBCMD_DOWNLOAD_FILE,
  SUBCMD_FILE_LIST,
  SUBCMD_STORAGE_INFO,
  SUBCMD_STORAGE_INIT,
  sendCommand
} from './protocol.js';
import {
  ParsedFileEntry,
  StorageCapacity,
  parseFileListResponse,
  stripChunkHeader,
  tryInterpretStorage
} from './parsers.js';

/** List recordings on the device, sorted latest-first. */
export async function listFiles(device: ClaimedDevice): Promise<ParsedFileEntry[]> {
  // Param 0x0E goes in byte 7 (see protocol.ts). 32 KB is enough for ~250
  // entries with the full record format; bump if you ever see truncation.
  const response = await sendCommand(
    device,
    CMD_GROUP_SYSTEM,
    SUBCMD_FILE_LIST,
    0x0e,
    0,
    null,
    { multiChunk: true, readSize: 32768 }
  );
  if (!response || response.length <= 12) return [];
  return parseFileListResponse(response);
}

/**
 * Query storage usage. Some firmware combos drop the first response after a
 * reconnect, so we retry up to 3 times, re-sending STORAGE_INIT each round
 * to flush the IN endpoint.
 */
export async function getStorageInfo(
  device: ClaimedDevice
): Promise<StorageCapacity | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(250);
    await sendCommand(device, CMD_GROUP_STORAGE, SUBCMD_STORAGE_INIT, 3, 0);
    const response = await sendCommand(
      device,
      CMD_GROUP_SYSTEM,
      SUBCMD_STORAGE_INFO,
      3,
      0
    );
    if (!response || response.length < 16) continue;
    const interp = tryInterpretStorage(response.slice(12));
    if (interp) return interp;
    // Got bytes but couldn't interpret — bail rather than spin forever.
    return null;
  }
  return null;
}

/** Hook for the UI to render speed / ETA while a download is in flight. */
export interface DownloadProgress {
  /** Total bytes received so far (after header stripping). */
  bytesReceived: number;
  /** Bytes received in the most recent chunk (for rolling-window speed calc). */
  chunkBytes: number;
}

export interface DownloadOptions {
  /** Called after every received chunk. */
  onProgress?: (p: DownloadProgress) => void;
  /** External abort signal — flip to true to short-circuit the loop. */
  shouldAbort?: () => boolean;
}

/**
 * Download a single recording's bytes. The returned `Uint8Array` is plain MP3
 * (MPEG-1 Layer III, 48 kHz mono, 96 kbps) — see DEVICE_NOTES.md.
 *
 * The wire protocol is:
 *   1. Send prep handshake (`12 34 00 0b 00 00 00 58 00 00 00 00`)
 *   2. Read prep response (timeout-tolerant)
 *   3. Wait ~100 ms
 *   4. Send the download command + filename
 *   5. Read 8192-byte chunks, **stripping the 12-byte header from each one**,
 *      until we see 3 consecutive empty chunks or hit MAX_CHUNKS.
 */
export async function downloadFile(
  device: ClaimedDevice,
  filename: string,
  options: DownloadOptions = {}
): Promise<Uint8Array> {
  // 1. Prep handshake — the device expects this exact byte sequence first.
  const prepQuery = new Uint8Array([
    0x12, 0x34, 0x00, 0x0b,
    0x00, 0x00, 0x00, 0x58,
    0x00, 0x00, 0x00, 0x00
  ]);
  await device.transferOut(HIDOCK_P1_OUT_ENDPOINT, prepQuery as BufferSource);

  // 2. Read prep response (1s timeout — discard whatever comes back).
  try {
    await Promise.race<USBInTransferResult>([
      device.transferIn(HIDOCK_P1_IN_ENDPOINT, 512),
      rejectAfter<USBInTransferResult>(1000)
    ]);
  } catch {
    // Ignore: the device sometimes doesn't reply here.
  }

  // 3. Settle.
  await sleep(100);

  // 4. Build + send the download command. Filename length goes in byte 11.
  const filenameBytes = new TextEncoder().encode(filename);
  const packet = new Uint8Array(12 + filenameBytes.length);
  packet[0] = PROTOCOL_MAGIC[0];
  packet[1] = PROTOCOL_MAGIC[1];
  packet[2] = CMD_GROUP_SYSTEM;
  packet[3] = SUBCMD_DOWNLOAD_FILE;
  packet[7] = 0x59;
  packet[11] = filenameBytes.length & 0xff;
  packet.set(filenameBytes, 12);
  await device.transferOut(HIDOCK_P1_OUT_ENDPOINT, packet as BufferSource);

  // 5. Read chunks. The chunk loop is deliberately resilient:
  //    - timeouts on chunk 0 fail fast (device didn't respond at all)
  //    - timeouts after that just count toward the empty-chunks budget
  //    - external aborts return whatever we've accumulated so far
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkNumber = 0;
  let consecutiveEmpty = 0;
  const MAX_CHUNKS = 500_000;
  const MAX_EMPTY = 3;

  while (chunkNumber < MAX_CHUNKS && consecutiveEmpty < MAX_EMPTY) {
    if (options.shouldAbort?.()) break;

    const timeout = chunkNumber === 0 ? 10_000 : 2_000;
    let chunk: Uint8Array | null = null;
    try {
      const result = await Promise.race<USBInTransferResult>([
        device.transferIn(HIDOCK_P1_IN_ENDPOINT, 8192),
        rejectAfter<USBInTransferResult>(timeout)
      ]);
      if (result.data && result.data.byteLength > 0) {
        // Use byteOffset + byteLength explicitly. `new Uint8Array(buffer)`
        // would view the entire underlying ArrayBuffer, which in some WebUSB
        // implementations is larger than the actual transfer payload — that
        // makes chunk[0..3] read garbage instead of the protocol header
        // and stripChunkHeader misses every chunk after the first. (.slice()
        // also copies the bytes off any pooled buffer the implementation
        // might recycle on the next transfer.)
        chunk = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset,
          result.data.byteLength
        ).slice();
      }
    } catch (err) {
      if ((err as Error).message === 'timeout') {
        if (chunkNumber === 0) break;
        consecutiveEmpty++;
        await sleep(100);
        continue;
      }
      break;
    }

    if (!chunk) {
      consecutiveEmpty++;
      await sleep(100);
      continue;
    }

    chunkNumber++;
    const stripped = stripChunkHeader(chunk);
    if (stripped.length === 0) {
      consecutiveEmpty++;
      continue;
    }

    chunks.push(stripped);
    totalBytes += stripped.length;
    consecutiveEmpty = 0;
    options.onProgress?.({ bytesReceived: totalBytes, chunkBytes: stripped.length });
  }

  if (totalBytes === 0) throw new Error('No data received');

  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}
