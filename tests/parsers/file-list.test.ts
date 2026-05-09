import { describe, expect, it } from 'vitest';
import { parseFileListResponse } from '../../src/renderer/src/usb/parsers';

/**
 * Build a synthetic file-list record matching the device's wire format:
 *   [05 00 00 1B] [filename] [00] [size BE32] [00 x6] [hash 11B] [field B 4B] [unknown 1B]
 */
function buildRecord(filename: string, sizeBytes: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(filename);
  const total = 4 + nameBytes.length + 1 + 4 + 6 + 11 + 4 + 1;
  const buf = new Uint8Array(total);
  let off = 0;
  buf.set([0x05, 0x00, 0x00, 0x1b], off); off += 4;
  buf.set(nameBytes, off); off += nameBytes.length;
  buf[off++] = 0x00; // pad
  // BIG-endian size
  const dv = new DataView(buf.buffer);
  dv.setUint32(off, sizeBytes, /* littleEndian= */ false); off += 4;
  // Padding + hash + fieldB + unknown — leave zero.
  return buf;
}

/** Wrap records in the 12-byte response header the device emits. */
function withHeader(...records: Uint8Array[]): Uint8Array {
  const totalLen = 12 + records.reduce((s, r) => s + r.length, 0);
  const out = new Uint8Array(totalLen);
  // Header is mostly opaque; just zeros are fine for parsing tests.
  let off = 12;
  for (const r of records) {
    out.set(r, off);
    off += r.length;
  }
  return out;
}

describe('parseFileListResponse', () => {
  it('parses Rec25 with the documented size (38,766,956 bytes)', () => {
    // Verified bytes from a real HiDock P1 firmware response, 2026-05.
    const data = withHeader(buildRecord('2026Apr29-101546-Rec25.hda', 38_766_956));
    const entries = parseFileListResponse(data);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('2026Apr29-101546-Rec25.hda');
    expect(entries[0].size).toBe(38_766_956);
  });

  it('parses Rec26 with the documented size (172,771,788 bytes)', () => {
    const data = withHeader(buildRecord('2026Apr29-124411-Rec26.hda', 172_771_788));
    const entries = parseFileListResponse(data);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(172_771_788);
  });

  it('parses multiple entries in one response', () => {
    const data = withHeader(
      buildRecord('2026Apr29-101546-Rec25.hda', 38_766_956),
      buildRecord('2026Apr29-124411-Rec26.hda', 172_771_788)
    );
    const entries = parseFileListResponse(data);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual([
      '2026Apr29-101546-Rec25.hda',
      '2026Apr29-124411-Rec26.hda'
    ]);
  });

  it('handles the older REC_YYYYMMDD_HHMMSS naming scheme', () => {
    const data = withHeader(buildRecord('REC_20260429_101546.hda', 1_234_567));
    const entries = parseFileListResponse(data);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('REC_20260429_101546.hda');
    expect(entries[0].size).toBe(1_234_567);
  });

  it('deduplicates if the same filename appears twice', () => {
    const data = withHeader(
      buildRecord('REC_20260429_101546.hda', 1000),
      buildRecord('REC_20260429_101546.hda', 1000)
    );
    expect(parseFileListResponse(data)).toHaveLength(1);
  });

  it('returns 0 for entries whose size field is out of range', () => {
    // Synthesize a record with a deliberately invalid size (< 1 KB).
    const data = withHeader(buildRecord('REC_20260429_101546.hda', 100));
    const entries = parseFileListResponse(data);
    expect(entries[0].size).toBe(0);
  });

  it('returns empty for null or short input', () => {
    expect(parseFileListResponse(null)).toEqual([]);
    expect(parseFileListResponse(new Uint8Array(8))).toEqual([]);
  });
});
