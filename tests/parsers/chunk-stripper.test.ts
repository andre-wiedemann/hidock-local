import { describe, expect, it } from 'vitest';
import { stripChunkHeader } from '../../src/renderer/src/usb/parsers';

describe('stripChunkHeader', () => {
  it('strips the 12-byte header when the magic bytes match', () => {
    const chunk = new Uint8Array([
      0x12, 0x34, 0x00, 0x05, 0x00, 0x00, 0x00, 0x59,
      0x00, 0x00, 0x1f, 0xf4,
      0xaa, 0xbb, 0xcc, 0xdd
    ]);
    const out = stripChunkHeader(chunk);
    expect(Array.from(out)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it('leaves the chunk alone if the header is not present', () => {
    const chunk = new Uint8Array([0x42, 0x42, 0x42, 0x42, 0xaa]);
    const out = stripChunkHeader(chunk);
    expect(out).toBe(chunk);
  });

  it('leaves chunks shorter than 12 bytes alone', () => {
    const chunk = new Uint8Array([0x12, 0x34, 0x00, 0x05]);
    const out = stripChunkHeader(chunk);
    expect(out).toBe(chunk);
  });

  it('only strips when the first 4 bytes match — not just the magic', () => {
    // First two bytes are the magic but subcommand differs.
    const chunk = new Uint8Array([
      0x12, 0x34, 0x00, 0x99, 0, 0, 0, 0, 0, 0, 0, 0, 0xff
    ]);
    const out = stripChunkHeader(chunk);
    expect(out).toBe(chunk);
  });
});
