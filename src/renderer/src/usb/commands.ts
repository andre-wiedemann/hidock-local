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
import { drainInEndpoint } from './protocol.js';
import {
  ParsedFileEntry,
  StorageCapacity,
  parseFileListResponse,
  stripAllProtocolHeaders,
  tryInterpretStorage
} from './parsers.js';

/** List recordings on the device, sorted latest-first. */
export async function listFiles(device: ClaimedDevice): Promise<ParsedFileEntry[]> {
  // Param 0x0E goes in byte 7 (see protocol.ts). We don't drain the IN
  // endpoint here despite the storage-info-fails-→-truncated-list
  // correlation; an experimental drain right before this transferOut
  // produced an empty response (the drain itself seems to disturb
  // some firmware state). The drain inside getStorageInfo's retry
  // loop is enough.
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
  /* eslint-disable no-console */
  console.log(`[file-list] received ${response.length} bytes from device`);
  // Hunt for filename-shaped substrings the parser might miss + count
  // recordings per day so we can compare with the standalone HTML's
  // panel directly when entries go missing.
  const text = new TextDecoder('latin1').decode(response.slice(12));
  const allMatches = text.match(/\d{4}[A-Za-z]{3}\d{2}/g) ?? [];
  const dayCounts: Record<string, number> = {};
  for (const m of allMatches) dayCounts[m] = (dayCounts[m] ?? 0) + 1;
  console.log(
    `[file-list] raw "YYYYMonDD" substrings in response: ${allMatches.length} ` +
    `(${Object.keys(dayCounts).length} unique days)`
  );
  console.log('[file-list] day counts:', dayCounts);
  /* eslint-enable no-console */
  return parseFileListResponse(response);
}

/**
 * Query storage usage. Some firmware combos drop the first response after a
 * reconnect, so we retry up to 3 times, re-sending STORAGE_INIT each round
 * to flush the IN endpoint. Storage info correctness also seems to gate
 * the FILE_LIST response size, so failing here silently propagates into
 * a smaller-than-expected file list — drain stale bytes before each
 * attempt so the response actually lands in our read window.
 */
export async function getStorageInfo(
  device: ClaimedDevice
): Promise<StorageCapacity | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(250);
    await drainInEndpoint(device, 200);
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

  // 5. Read chunks. We accumulate raw device bytes here without trying to
  //    strip the per-frame protocol header — that gets done in one pass
  //    over the assembled buffer below. Per-chunk stripping was fragile:
  //    a single short transferIn read pushed every subsequent chunk's
  //    header off byte 0 of its view and the magic-byte check missed.
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

    chunks.push(chunk);
    totalBytes += chunk.length;
    chunkNumber++;
    consecutiveEmpty = 0;
    options.onProgress?.({ bytesReceived: totalBytes, chunkBytes: chunk.length });
  }

  if (totalBytes === 0) throw new Error('No data received');

  // Assemble + strip every protocol header in one sweep.
  const raw = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    raw.set(c, offset);
    offset += c.length;
  }
  return stripAllProtocolHeaders(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}
