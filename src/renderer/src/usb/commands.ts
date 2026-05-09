import { HIDOCK_P1_IN_ENDPOINT, HIDOCK_P1_OUT_ENDPOINT, PROTOCOL_MAGIC } from '../../../shared/types.js';
import {
  CMD_GET_BATTERY_STATUS,
  CMD_GET_RECORDING_QUALITY,
  CMD_GET_SETTINGS,
  CMD_GROUP_SYSTEM,
  CMD_QUERY_DEVICE_INFO,
  CMD_QUERY_DEVICE_TIME,
  CMD_QUERY_FILE_LIST,
  CMD_READ_CARD_INFO,
  CMD_SET_DEVICE_TIME,
  ClaimedDevice,
  SUBCMD_DOWNLOAD_FILE,
  resetSequence,
  sendCmd
} from './protocol.js';
import {
  ParsedFileEntry,
  StorageCapacity,
  parseFileListResponse,
  stripAllProtocolHeaders,
  tryInterpretStorage
} from './parsers.js';

/**
 * BCD-encode the host's current local time as 7 bytes:
 *   [YY YY MM DD HH MM SS] (each byte two BCD nibbles).
 *
 * Matches the vendor's `to_bcd("YYYYMMDDHHMMSS")` exactly.
 */
function bcdEncodeNow(d: Date = new Date()): Uint8Array {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const s =
    `${d.getFullYear()}` +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  // 14 chars → 7 bytes.
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    out[i / 2] = ((s.charCodeAt(i) - 48) << 4) | (s.charCodeAt(i + 1) - 48);
  }
  return out;
}

/**
 * Run the vendor's full device-init sequence (captured from HiNotes
 * runtime). The HiDock falls into a truncated "warm" state for
 * QUERY_FILE_LIST when not properly initialized, returning fewer
 * entries than it actually has on disk. This sequence puts it in the
 * state where the file list is complete.
 *
 * Each call resets the sequence counter, so every fresh connect starts
 * from sqidx=1 just like the vendor app.
 */
export async function runInitSequence(device: ClaimedDevice): Promise<void> {
  resetSequence();
  /* eslint-disable no-console */
  const log = async (label: string, cmd: number, body?: Uint8Array): Promise<void> => {
    const t0 = performance.now();
    const r = await sendCmd(device, cmd, body ?? null, { readSize: 4096, timeoutMs: 2000 });
    const dt = (performance.now() - t0).toFixed(0);
    const head = r ? Array.from(r.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join(' ') : '(null)';
    console.log(`[init] ${label}  cmd=0x${cmd.toString(16).padStart(4, '0')}  ← ${r?.length ?? 0}B  ${dt}ms  ${head}${r && r.length > 16 ? '…' : ''}`);
  };
  await log('QUERY_DEVICE_INFO    ', CMD_QUERY_DEVICE_INFO);
  await log('QUERY_DEVICE_TIME    ', CMD_QUERY_DEVICE_TIME);
  await log('SET_DEVICE_TIME      ', CMD_SET_DEVICE_TIME, bcdEncodeNow());
  await log('GET_SETTINGS         ', CMD_GET_SETTINGS);
  await log('GET_RECORDING_QUALITY', CMD_GET_RECORDING_QUALITY);
  await log('READ_CARD_INFO       ', CMD_READ_CARD_INFO);
  await log('GET_BATTERY_STATUS   ', CMD_GET_BATTERY_STATUS);
  /* eslint-enable no-console */
}

/** List recordings on the device, sorted latest-first. */
export async function listFiles(device: ClaimedDevice): Promise<ParsedFileEntry[]> {
  // Uses the v2 sender so the sequence number auto-increments off the
  // counter the init sequence already advanced. Hard-coding seq=14
  // (the legacy compat behavior) collides with init's seq=1-7 and
  // appears to put the device into the truncated-response state.
  const response = await sendCmd(
    device,
    CMD_QUERY_FILE_LIST,
    null,
    { multiChunk: true, readSize: 32768 }
  );
  if (!response || response.length <= 12) return [];
  /* eslint-disable no-console */
  console.log(`[file-list] received ${response.length} bytes from device`);
  // Extract printable ASCII after each delimiter — that's the
  // filename region. If our parser misses a record, listing all
  // 224 surfaces the odd one out.
  const payload = response.slice(12);
  const FULL_RE = /(REC_\d{8}_\d{6}\.hda|\d{4}[A-Za-z]{3}\d{2}-\d{6}-Rec\d+\.hda)/i;
  const records: { idx: number; preview: string; matchesRegex: boolean }[] = [];
  for (let i = 0; i + 4 <= payload.length; i++) {
    if (
      payload[i] === 0x05 && payload[i + 1] === 0x00 &&
      payload[i + 2] === 0x00 && payload[i + 3] === 0x1b
    ) {
      const start = i + 4;
      const end = Math.min(start + 40, payload.length);
      let s = '';
      for (let j = start; j < end; j++) {
        const b = payload[j];
        if (b >= 32 && b < 127) s += String.fromCharCode(b);
        else break;
      }
      records.push({
        idx: records.length,
        preview: s,
        matchesRegex: FULL_RE.test(s)
      });
      i += 3;
    }
  }
  const orphans = records.filter((r) => !r.matchesRegex);
  console.log(`[file-list] records on wire: ${records.length}, regex misses: ${orphans.length}`);
  if (orphans.length > 0) {
    console.log('[file-list] records the regex doesn\'t match:', orphans.map((r) => `#${r.idx}: ${JSON.stringify(r.preview)}`));
  }
  /* eslint-enable no-console */
  return parseFileListResponse(response);
}

/**
 * Query storage usage. Init already runs READ_CARD_INFO, so this is the
 * on-demand refresh path (called from the storage panel + before each
 * List Files). Single sendCmd via the auto-increment counter — the
 * legacy retry/drain dance was working around the sequence-collision
 * issue we now sidestep at the source.
 */
export async function getStorageInfo(
  device: ClaimedDevice
): Promise<StorageCapacity | null> {
  const response = await sendCmd(device, CMD_READ_CARD_INFO);
  if (!response || response.length < 16) return null;
  return tryInterpretStorage(response.slice(12));
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}
