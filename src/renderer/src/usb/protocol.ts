import {
  HIDOCK_P1_IN_ENDPOINT,
  HIDOCK_P1_OUT_ENDPOINT,
  PROTOCOL_MAGIC
} from '../../../shared/types.js';

/** Top-level command groups. */
export const CMD_GROUP_SYSTEM = 0x00;
export const CMD_GROUP_STORAGE = 0x10;

/** Sub-commands within `CMD_GROUP_SYSTEM`. */
export const SUBCMD_DEVICE_INFO = 0x01;
export const SUBCMD_FILE_LIST = 0x04;
export const SUBCMD_DOWNLOAD_FILE = 0x05;
export const SUBCMD_STORAGE_INFO = 0x10;

/** Sub-command within `CMD_GROUP_STORAGE`. */
export const SUBCMD_STORAGE_INIT = 0x04;

/**
 * Some commands take their parameter at byte 7 instead of byte 4 — discovered
 * empirically against live firmware. List-files is the most common one to
 * trip on (param=0x0E goes in byte 7, not byte 4).
 */
function needsParamInByte7(cmd1: number, cmd2: number): boolean {
  return (
    (cmd1 === CMD_GROUP_SYSTEM && cmd2 === SUBCMD_DEVICE_INFO) ||
    (cmd1 === CMD_GROUP_SYSTEM && cmd2 === SUBCMD_FILE_LIST) ||
    (cmd1 === CMD_GROUP_SYSTEM && cmd2 === SUBCMD_STORAGE_INFO) ||
    (cmd1 === CMD_GROUP_STORAGE && cmd2 === SUBCMD_STORAGE_INIT)
  );
}

/**
 * Build a 12-byte command packet (plus optional payload) ready for the OUT
 * endpoint. Layout:
 *
 *   [0..1] PROTOCOL_MAGIC
 *   [2]    cmd1 (group)
 *   [3]    cmd2 (sub-command)
 *   [4..11] parameter bytes (param goes in byte 4 OR byte 7 depending on cmd)
 *   [12..] optional payload
 */
export function buildCommandPacket(
  cmd1: number,
  cmd2: number,
  param1 = 0,
  param2 = 0,
  extraData: Uint8Array | null = null
): Uint8Array {
  const extraLength = extraData ? extraData.length : 0;
  const packet = new Uint8Array(12 + extraLength);

  packet[0] = PROTOCOL_MAGIC[0];
  packet[1] = PROTOCOL_MAGIC[1];
  packet[2] = cmd1;
  packet[3] = cmd2;

  if (needsParamInByte7(cmd1, cmd2)) {
    packet[7] = param1 & 0xff;
  } else {
    packet[4] = param1 & 0xff;
    packet[8] = param2 & 0xff;
  }

  if (extraData && extraLength > 0) packet.set(extraData, 12);
  return packet;
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
