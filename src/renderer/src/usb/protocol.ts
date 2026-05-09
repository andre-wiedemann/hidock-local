import {
  HIDOCK_P1_IN_ENDPOINT,
  HIDOCK_P1_OUT_ENDPOINT,
  PROTOCOL_MAGIC
} from '../../../shared/types.js';

// ─── 16-bit command codes (per HiNotes vendor JS) ───────────────────────
// The header at bytes 2..3 is a single big-endian uint16, not separate
// cmd1/cmd2 bytes. See docs/PROTOCOL_RE_NOTES.md for the full table.

export const CMD_QUERY_DEVICE_INFO     = 0x0001;
export const CMD_QUERY_DEVICE_TIME     = 0x0002;
export const CMD_SET_DEVICE_TIME       = 0x0003;
export const CMD_QUERY_FILE_LIST       = 0x0004;
export const CMD_TRANSFER_FILE         = 0x0005;
export const CMD_QUERY_FILE_COUNT      = 0x0006;
export const CMD_DELETE_FILE           = 0x0007;
export const CMD_GET_SETTINGS          = 0x000b;
export const CMD_SET_SETTINGS          = 0x000c;
export const CMD_GET_FILE_BLOCK        = 0x000d;
export const CMD_READ_CARD_INFO        = 0x0010;
export const CMD_FORMAT_CARD           = 0x0011;
export const CMD_GET_RECORDING_STATUS  = 0x001d;
export const CMD_SET_RECORDING_QUALITY = 0x001e;
export const CMD_GET_RECORDING_QUALITY = 0x001f;
export const CMD_GET_BATTERY_STATUS    = 0x1004;

// ─── Legacy aliases (until call sites migrate) ─────────────────────────
// Byte values are unchanged; only the labels are corrected. We keep the
// old names exported as aliases of the v2 codes so the existing
// commands.ts compiles during the rewrite.

/** @deprecated use CMD_QUERY_DEVICE_INFO */
export const CMD_GROUP_SYSTEM = 0x00;
/** @deprecated The legacy "STORAGE_INIT" was actually GET_BATTERY_STATUS. */
export const CMD_GROUP_STORAGE = 0x10;
/** @deprecated use CMD_QUERY_DEVICE_INFO */
export const SUBCMD_DEVICE_INFO = 0x01;
/** @deprecated use CMD_QUERY_FILE_LIST */
export const SUBCMD_FILE_LIST = 0x04;
/** @deprecated use CMD_TRANSFER_FILE */
export const SUBCMD_DOWNLOAD_FILE = 0x05;
/** @deprecated use CMD_READ_CARD_INFO */
export const SUBCMD_STORAGE_INFO = 0x10;
/** @deprecated this constant historically named "STORAGE_INIT" was GET_BATTERY_STATUS in disguise. */
export const SUBCMD_STORAGE_INIT = 0x04;

// ─── Sequence counter ──────────────────────────────────────────────────
// HiNotes auto-increments a per-session sqidx per command. The device
// uses it to correlate request/response pairs and (we suspect) to gate
// the file-list response state. Reset on every fresh connect.

let sqidx = 0;

export function resetSequence(): void {
  sqidx = 0;
}

export function nextSequence(): number {
  return ++sqidx;
}

export function currentSequence(): number {
  return sqidx;
}

/**
 * Build a 12-byte command header + optional body, matching the vendor
 * format exactly:
 *
 *   [0..1]   magic 0x12 0x34
 *   [2..3]   command (BE uint16)
 *   [4..7]   sequence index (BE uint32)
 *   [8..11]  body length (BE uint32)
 *   [12..]   body bytes
 */
export function buildCommand(
  command: number,
  body: Uint8Array | null = null,
  sequence: number = nextSequence()
): Uint8Array {
  const bodyLen = body?.length ?? 0;
  const packet = new Uint8Array(12 + bodyLen);
  packet[0] = PROTOCOL_MAGIC[0];
  packet[1] = PROTOCOL_MAGIC[1];
  packet[2] = (command >> 8) & 0xff;
  packet[3] = command & 0xff;
  packet[4] = (sequence >> 24) & 0xff;
  packet[5] = (sequence >> 16) & 0xff;
  packet[6] = (sequence >> 8) & 0xff;
  packet[7] = sequence & 0xff;
  packet[8] = (bodyLen >> 24) & 0xff;
  packet[9] = (bodyLen >> 16) & 0xff;
  packet[10] = (bodyLen >> 8) & 0xff;
  packet[11] = bodyLen & 0xff;
  if (body && bodyLen > 0) packet.set(body, 12);
  return packet;
}

/**
 * @deprecated Compatibility shim for callers that still pass
 * (cmd1, cmd2, param1, param2, body). Maps to buildCommand by
 * combining cmd1/cmd2 into a 16-bit code and using param1 (at the
 * low byte of the seq field) as the sequence number — preserves
 * the byte sequence the legacy callers expected for FILE_LIST etc.
 */
export function buildCommandPacket(
  cmd1: number,
  cmd2: number,
  param1 = 0,
  _param2 = 0,
  extraData: Uint8Array | null = null
): Uint8Array {
  const command = ((cmd1 & 0xff) << 8) | (cmd2 & 0xff);
  // Use the legacy `param1` value as the sequence — the device tolerated
  // hard-coded values like 0x0E because byte 7 is the seq-low byte.
  return buildCommand(command, extraData, param1 & 0xff);
}

/** A USBDevice that's already open + claimed on interface 0. */
export type ClaimedDevice = USBDevice;

interface SendCommandOpts {
  /** Bytes to read back from IN endpoint. Default 512. */
  readSize?: number;
  /** Single-read response timeout in ms. Default 3000. */
  timeoutMs?: number;
  /** If true, accumulate chunks until short read or `readSize` reached. */
  multiChunk?: boolean;
}

/**
 * Send a command using the v2 packet format and read the response.
 * The sequence number auto-increments via `nextSequence()` (call
 * `resetSequence()` on connect to start the per-session counter from 0).
 */
export async function sendCmd(
  device: ClaimedDevice,
  command: number,
  body: Uint8Array | null = null,
  opts: SendCommandOpts = {}
): Promise<Uint8Array | null> {
  const readSize = opts.readSize ?? 512;
  const timeoutMs = opts.timeoutMs ?? 3000;

  const packet = buildCommand(command, body);
  await device.transferOut(HIDOCK_P1_OUT_ENDPOINT, packet as BufferSource);

  if (opts.multiChunk) {
    return readMultipleChunks(device, readSize);
  }

  try {
    const result = await raceTimeout(
      device.transferIn(HIDOCK_P1_IN_ENDPOINT, readSize),
      timeoutMs
    );
    if (result.data && result.data.byteLength > 0) {
      return new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength
      ).slice();
    }
  } catch {
    // Treat timeouts as no-data; the caller may retry.
  }
  return null;
}

/**
 * Send a command and read the response from the IN endpoint.
 *
 * For the file-list command we read multiple chunks because the response can
 * span 32 KB. For everything else we do a single read with a short timeout
 * and fall back to `null` on timeout — the caller decides if that's an error.
 */
export async function sendCommand(
  device: ClaimedDevice,
  cmd1: number,
  cmd2: number,
  param1 = 0,
  param2 = 0,
  extraData: Uint8Array | null = null,
  opts: SendCommandOpts = {}
): Promise<Uint8Array | null> {
  const readSize = opts.readSize ?? 512;
  const timeoutMs = opts.timeoutMs ?? 3000;

  const packet = buildCommandPacket(cmd1, cmd2, param1, param2, extraData);
  await device.transferOut(HIDOCK_P1_OUT_ENDPOINT, packet as BufferSource);

  if (opts.multiChunk) {
    return readMultipleChunks(device, readSize);
  }

  try {
    const result = await raceTimeout(
      device.transferIn(HIDOCK_P1_IN_ENDPOINT, readSize),
      timeoutMs
    );
    if (result.data && result.data.byteLength > 0) {
      return new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength
      ).slice();
    }
  } catch {
    // Treat timeouts as no-data; the caller may retry.
  }
  return null;
}

async function readMultipleChunks(
  device: ClaimedDevice,
  readSize: number
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  // Each transferIn pulls up to 16 KB. 32 attempts × 16 KB = 512 KB ceiling
  // — matches readSize=131072 (file list) with margin for short reads.
  const MAX_ATTEMPTS = 32;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (totalBytes >= readSize) break;
    const remaining = Math.min(readSize - totalBytes, 16384);
    try {
      // First read gets a longer window because the device may take a
      // beat to assemble the response. Subsequent reads use 3s — the
      // older 1s budget would cut off mid-list when the device's flash
      // scan paused, dropping tail entries silently.
      const result = await raceTimeout(
        device.transferIn(HIDOCK_P1_IN_ENDPOINT, remaining),
        attempt === 0 ? 5000 : 3000
      );

      if (!result.data || result.data.byteLength === 0) break;

      const chunk = new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength
      ).slice();
      chunks.push(chunk);
      totalBytes += chunk.length;

      // Don't break on short reads — the device sometimes fragments the
      // response into <512-byte trailing pieces while there's still data
      // queued up. Rely on timeouts and the empty-data branch above to
      // detect the actual end of the response.
    } catch {
      // Timeout — treat as end-of-response.
      break;
    }
  }

  if (chunks.length === 0) return null;
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    )
  ]);
}

/**
 * Discard any bytes still queued on the device's IN endpoint from
 * previous commands. We've observed that small (< response-size) reads
 * leave trailing data in the buffer; the next command's response then
 * gets queued *behind* those stale bytes, our short read pulls only the
 * leftovers, and the real response times out.
 *
 * Call this before any sendCommand sequence whose response correctness
 * depends on a clean buffer (storage info, file list).
 */
export async function drainInEndpoint(
  device: ClaimedDevice,
  budgetMs = 500
): Promise<number> {
  let drained = 0;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const result = await raceTimeout(
        device.transferIn(HIDOCK_P1_IN_ENDPOINT, 16384),
        50
      );
      if (!result.data || result.data.byteLength === 0) break;
      drained += result.data.byteLength;
    } catch {
      break;
    }
  }
  return drained;
}
