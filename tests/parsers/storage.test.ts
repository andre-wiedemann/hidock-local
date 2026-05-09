import { describe, expect, it } from 'vitest';
import { tryInterpretStorage } from '../../src/renderer/src/usb/parsers';

/**
 * Build a 28-byte storage-info payload with the HIDOCK magic at offset 16,
 * given used + total block counts.
 */
function buildPayload(usedBlocks: number, totalBlocks: number): Uint8Array {
  const buf = new Uint8Array(28);
  const dv = new DataView(buf.buffer);
  // Bytes 0..7 are firmware metadata — leave zero.
  dv.setUint32(8, usedBlocks, /* littleEndian= */ true);
  dv.setUint32(12, totalBlocks, /* littleEndian= */ true);
  // Bytes 16..21 are the HIDOCK ASCII magic.
  buf.set([0x48, 0x49, 0x44, 0x4f, 0x43, 0x4b], 16); // "HIDOCK"
  return buf;
}

describe('tryInterpretStorage (HIDOCK-magic path)', () => {
  it('decodes a full 64 GB device', () => {
    // 33,554,432 × 2048 = 64 GiB exactly
    const payload = buildPayload(0, 33_554_432);
    const result = tryInterpretStorage(payload);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(64 * 1024 * 1024 * 1024);
    expect(result!.usedBytes).toBe(0);
    expect(result!.label).toContain('HIDOCK magic');
  });

  it('reports used bytes correctly', () => {
    const payload = buildPayload(1024, 33_554_432); // 2 MB used of 64 GB
    const result = tryInterpretStorage(payload);
    expect(result!.usedBytes).toBe(2 * 1024 * 1024);
  });

  it('rejects payloads with the magic missing', () => {
    const payload = buildPayload(0, 33_554_432);
    payload[16] = 0; // Corrupt the magic
    const result = tryInterpretStorage(payload);
    // Falls back to heuristic; with only zeroed magic and the actual block
    // counts, the heuristic may still find a match — verify it's not the
    // anchored path.
    if (result) expect(result.label).not.toContain('HIDOCK magic');
  });

  it('returns null for tiny payloads', () => {
    expect(tryInterpretStorage(new Uint8Array(0))).toBeNull();
    expect(tryInterpretStorage(new Uint8Array(8))).toBeNull();
  });

  it('rejects implausibly large totals', () => {
    // 1 PB worth of blocks — way above STORAGE_MAX_BYTES.
    const payload = buildPayload(0, 0xffff_ffff);
    const result = tryInterpretStorage(payload);
    // Either null or it falls through to heuristic which also rejects.
    if (result) {
      expect(result.totalBytes).toBeLessThanOrEqual(256 * 1024 * 1024 * 1024);
    }
  });
});
