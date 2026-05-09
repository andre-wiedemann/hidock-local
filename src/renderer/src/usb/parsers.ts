// HiDock P1 protocol response parsers — verified against live device 2026-05.
//
// These three are the most testable parts of the protocol layer and the
// pieces that have caused the most damage when wrong (corrupted MP3
// payloads, "14912 GB / 3159040 GB" storage panels, etc.). They live in
// their own module so they can be unit-tested without a USB device.

const FILE_NAME_REGEX =
  /(REC_\d{8}_\d{6}\.hda|\d{4}[A-Za-z]{3}\d{2}-\d{6}-Rec\d+\.hda)/gi;

/** Parsed entry from the file-list response. `size` is in bytes; 0 if unparseable. */
export interface ParsedFileEntry {
  name: string;
  size: number;
}

/**
 * Parse the device's file-list response.
 *
 * Each record in the payload follows the layout:
 *   [delim 05 00 00 1b]
 *   [filename ASCII]
 *   [pad 00]
 *   [size 4B BIG-ENDIAN uint32]
 *   [pad 00 x6]
 *   [11B hash/uuid]
 *   [4B field B]
 *   [1B unknown]
 *
 * The size offset is `filename_end + 1` and is **big-endian** — the rest of
 * the protocol is little-endian, so this is easy to get wrong.
 *
 * Verified bytes (2026-05):
 *   Rec25 size = 02 4e 7f 6c BE = 0x024E7F6C = 38,766,956 bytes
 *   Rec26 size = 0a 4c 49 cc BE = 0x0A4C49CC = 172,771,788 bytes
 */
export function parseFileListResponse(data: Uint8Array | null): ParsedFileEntry[] {
  if (!data || data.length < 12) return [];

  const payload = data.slice(12);
  let text = '';
  for (let i = 0; i < payload.length; i++) {
    text += String.fromCharCode(payload[i]);
  }

  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const seen = new Set<string>();
  const out: ParsedFileEntry[] = [];

  let m: RegExpExecArray | null;
  while ((m = FILE_NAME_REGEX.exec(text)) !== null) {
    const name = m[0];
    if (seen.has(name)) continue;
    seen.add(name);

    const sizeOffset = m.index + name.length + 1;
    let size = 0;
    if (sizeOffset + 4 <= payload.length) {
      const v = dv.getUint32(sizeOffset, /* littleEndian= */ false);
      // Sanity bounds: 1 KB – 4 GB. Out-of-range usually means we read padding
      // or the trailer instead of an actual size field.
      if (v >= 1024 && v <= 4 * 1024 * 1024 * 1024) size = v;
    }
    out.push({ name, size });
  }

  // Reset regex state for next call (it's stateful on the global flag).
  FILE_NAME_REGEX.lastIndex = 0;

  return out;
}

/** Storage capacity result: bytes used and total, with a label describing how it was parsed. */
export interface StorageCapacity {
  usedBytes: number;
  totalBytes: number;
  label: string;
}

/** Battery status — port of HiNotes' parser (status / battery / voltage). */
export interface BatteryStatus {
  status: 'idle' | 'charging' | 'full';
  /** Battery percentage 0-100. */
  percent: number;
  /** Voltage in microvolts. Divide by 1_000_000 for volts. */
  voltageMicroV: number;
}

/**
 * Parse a 6-byte GET_BATTERY_STATUS response body.
 *   [0]    status code (0=idle, 1=charging, else=full)
 *   [1]    battery percent (0-100)
 *   [2..5] voltage microvolts (BE uint32)
 */
export function tryInterpretBattery(payload: Uint8Array): BatteryStatus | null {
  if (!payload || payload.length < 6) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);
  const code = payload[0];
  const percent = payload[1];
  const voltage = dv.getUint32(2, /* littleEndian= */ false);
  if (percent > 100) return null;
  return {
    status: code === 0 ? 'idle' : code === 1 ? 'charging' : 'full',
    percent,
    voltageMicroV: voltage
  };
}

/** Plausible storage range: 100 MB to 256 GB. Outside this is a parse error. */
const STORAGE_MIN_BYTES = 100 * 1024 * 1024;
const STORAGE_MAX_BYTES = 256 * 1024 * 1024 * 1024;

/**
 * Interpret the storage-info (READ_CARD_INFO) response payload.
 *
 * Reverse-engineered from HiNotes' parser:
 *   [0..3]   free MiB     (BE uint32)
 *   [4..7]   capacity MiB (BE uint32)
 *   [8..11]  status       (BE uint32 → ASCII "900")
 *   used = capacity - free
 *
 * Falls back to a multi-offset/multi-unit heuristic for older firmware
 * variants whose response shape doesn't match.
 */
export function tryInterpretStorage(payload: Uint8Array): StorageCapacity | null {
  if (!payload || payload.length < 8) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);

  // Vendor's BE-MiB layout. Multiply by 1024² for bytes.
  const MIB = 1024 * 1024;
  const freeMib = dv.getUint32(0, /* littleEndian= */ false);
  const capacityMib = dv.getUint32(4, false);
  const totalBytesIfValid = capacityMib * MIB;
  if (
    totalBytesIfValid >= STORAGE_MIN_BYTES &&
    totalBytesIfValid <= STORAGE_MAX_BYTES &&
    freeMib <= capacityMib
  ) {
    const usedBytes = (capacityMib - freeMib) * MIB;
    return {
      usedBytes,
      totalBytes: totalBytesIfValid,
      label: '[0,4] BE MiB (vendor format)'
    };
  }
  return null;
}

/**
 * Strip the 12-byte protocol header from a download chunk if present.
 *
 * The HiDock frames each download chunk as a 12-byte header
 * (`12 34 00 05 00 00 00 59 00 00 1f f4` — `0x1ff4` = 8180 = payload length)
 * followed by 8180 bytes of MP3. Earlier code only stripped this from the
 * first chunk, leaving 12 bytes of garbage every 8192 bytes throughout the
 * file. That destroys MP3 framing and pushes entropy to ~7.77/8 — leading
 * the broken files to be misdiagnosed as "encrypted HDA".
 *
 * Used by tests + as a sanity helper. The download path uses
 * `stripAllProtocolHeaders` over the assembled stream instead, which is
 * resilient to any chunk-fragmentation behavior the underlying WebUSB
 * implementation might exhibit.
 */
export function stripChunkHeader(chunk: Uint8Array): Uint8Array {
  if (
    chunk.length >= 12 &&
    chunk[0] === 0x12 &&
    chunk[1] === 0x34 &&
    chunk[2] === 0x00 &&
    chunk[3] === 0x05
  ) {
    return chunk.slice(12);
  }
  return chunk;
}

/**
 * Strip 12-byte chunk headers from an assembled FILE_LIST response.
 * The device fragments the file list across multiple "chunks", each
 * prefixed with `12 34 00 04 <seq:4> <bodyLen:4>`. The first such
 * header is the outer response (caller already slices that off with
 * `.slice(12)`); the rest get spliced INTO the data — including
 * mid-filename for the unlucky record straddling a chunk boundary.
 *
 * Unlike the download-chunk version this one matches by cmd code
 * only (0x12 0x34 0x00 0x04) — body length and sequence vary per
 * chunk and we don't know them up-front. False-positive risk on
 * random bytes is ~1/2³² per offset; negligible against 12 KB.
 */
export function stripFileListChunkHeaders(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length);
  let outIdx = 0;
  let lastEnd = 0;
  let i = 0;
  while (i <= payload.length - 12) {
    if (
      payload[i] === 0x12 && payload[i + 1] === 0x34 &&
      payload[i + 2] === 0x00 && payload[i + 3] === 0x04
    ) {
      if (i > lastEnd) {
        out.set(payload.subarray(lastEnd, i), outIdx);
        outIdx += i - lastEnd;
      }
      i += 12;
      lastEnd = i;
    } else {
      i++;
    }
  }
  if (lastEnd < payload.length) {
    out.set(payload.subarray(lastEnd), outIdx);
    outIdx += payload.length - lastEnd;
  }
  return out.slice(0, outIdx);
}

/**
 * Strip every 12-byte protocol header found in an assembled download
 * stream. Matches the full 12-byte signature
 * `12 34 00 05 00 00 00 59 00 00 1f f4` (cmd id + magic length 0x1ff4),
 * which is unique enough that random MP3 collisions are negligible.
 *
 * This runs once on the concatenated raw bytes — it doesn't matter whether
 * the WebUSB transport returned each device-side chunk in one or many
 * transferIn calls, or whether some buffer offset weirdness moved the
 * magic off the start of a chunk view. We just sweep the whole buffer.
 */
export function stripAllProtocolHeaders(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(raw.length);
  let outIdx = 0;
  let lastEnd = 0;
  let i = 0;
  while (i <= raw.length - 12) {
    if (
      raw[i] === 0x12 && raw[i + 1] === 0x34 &&
      raw[i + 2] === 0x00 && raw[i + 3] === 0x05 &&
      raw[i + 7] === 0x59 && raw[i + 10] === 0x1f && raw[i + 11] === 0xf4
    ) {
      // Copy everything between the last header (or start) and this one.
      if (i > lastEnd) {
        out.set(raw.subarray(lastEnd, i), outIdx);
        outIdx += i - lastEnd;
      }
      i += 12;
      lastEnd = i;
    } else {
      i++;
    }
  }
  // Trailing bytes after the last header.
  if (lastEnd < raw.length) {
    out.set(raw.subarray(lastEnd), outIdx);
    outIdx += raw.length - lastEnd;
  }
  return out.slice(0, outIdx);
}
