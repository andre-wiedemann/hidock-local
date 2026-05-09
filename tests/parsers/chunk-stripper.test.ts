import { describe, expect, it } from 'vitest';
import { stripAllProtocolHeaders, stripChunkHeader } from '../../src/renderer/src/usb/parsers';

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

describe('stripAllProtocolHeaders', () => {
  const HEADER = [0x12, 0x34, 0x00, 0x05, 0x00, 0x00, 0x00, 0x59, 0x00, 0x00, 0x1f, 0xf4];

  function buildChunk(payloadByte: number, length: number): number[] {
    return [...HEADER, ...Array(length).fill(payloadByte)];
  }

  it('strips a single header at the start', () => {
    const raw = new Uint8Array([...HEADER, 0xaa, 0xbb, 0xcc]);
    expect(Array.from(stripAllProtocolHeaders(raw))).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('strips multiple headers throughout the stream', () => {
    const raw = new Uint8Array([
      ...buildChunk(0xaa, 3),
      ...buildChunk(0xbb, 3),
      ...buildChunk(0xcc, 3)
    ]);
    expect(Array.from(stripAllProtocolHeaders(raw))).toEqual([
      0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xcc, 0xcc, 0xcc
    ]);
  });

  it('handles a misaligned first chunk + properly-aligned subsequent ones', () => {
    // Simulates the actual bug: first transferIn returns a partial chunk
    // (header + short payload), subsequent reads return full chunks. The
    // sweep should strip every header regardless of position.
    const raw = new Uint8Array([
      ...buildChunk(0x11, 80),  // 92 bytes (12 hdr + 80 payload)
      ...buildChunk(0x22, 100)  // 112 bytes
    ]);
    const out = stripAllProtocolHeaders(raw);
    expect(out.length).toBe(180);
    expect(out[0]).toBe(0x11);
    expect(out[79]).toBe(0x11);
    expect(out[80]).toBe(0x22);
    expect(out[179]).toBe(0x22);
  });

  it('passes through bytes that have no header', () => {
    const raw = new Uint8Array([0xff, 0xfb, 0xaa, 0xbb, 0xcc]);
    expect(Array.from(stripAllProtocolHeaders(raw))).toEqual([0xff, 0xfb, 0xaa, 0xbb, 0xcc]);
  });

  it('does not match the partial 4-byte magic without the rest of the signature', () => {
    // 12 34 00 05 appears, but the trailing bytes don't match the full
    // 12-byte signature — must NOT strip.
    const raw = new Uint8Array([
      0x12, 0x34, 0x00, 0x05, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99,
      0xaa, 0xbb
    ]);
    expect(Array.from(stripAllProtocolHeaders(raw))).toEqual(Array.from(raw));
  });
});
