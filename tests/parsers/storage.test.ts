import { describe, expect, it } from 'vitest';
import { tryInterpretBattery, tryInterpretStorage } from '../../src/renderer/src/usb/parsers';

/**
 * Build a storage-info payload in the vendor's BE-MiB format:
 *   [0..3]  free MiB     (BE uint32)
 *   [4..7]  capacity MiB (BE uint32)
 */
function buildStoragePayload(freeMib: number, capacityMib: number): Uint8Array {
  const buf = new Uint8Array(28);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, freeMib, /* littleEndian= */ false);
  dv.setUint32(4, capacityMib, false);
  // Optional ASCII status bytes — vendor returns "900" at offset 8 onwards.
  return buf;
}

const MIB = 1024 * 1024;

describe('tryInterpretStorage (vendor BE-MiB format)', () => {
  it('decodes a full 64 GB device, all free', () => {
    // 65,536 MiB capacity (64 GiB), 0 used.
    const payload = buildStoragePayload(65_536, 65_536);
    const result = tryInterpretStorage(payload);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(65_536 * MIB);
    expect(result!.usedBytes).toBe(0);
    expect(result!.label).toContain('vendor format');
  });

  it('decodes the user\'s actual 64 GB card with 6.06 GB used', () => {
    // From vendor runtime log: free=53440 capacity=59648
    const payload = buildStoragePayload(53_440, 59_648);
    const result = tryInterpretStorage(payload);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(59_648 * MIB);   // 58.25 GiB usable
    expect(result!.usedBytes).toBe(6_208 * MIB);     // 6.06 GiB used
  });

  it('rejects implausibly small or large capacity values', () => {
    expect(tryInterpretStorage(buildStoragePayload(0, 50))).toBeNull();         // < 100 MB
    expect(tryInterpretStorage(buildStoragePayload(0, 500_000))).toBeNull();    // > 256 GB
  });

  it('rejects free > capacity (corrupt response)', () => {
    expect(tryInterpretStorage(buildStoragePayload(60_000, 50_000))).toBeNull();
  });

  it('returns null for tiny payloads', () => {
    expect(tryInterpretStorage(new Uint8Array(0))).toBeNull();
    expect(tryInterpretStorage(new Uint8Array(4))).toBeNull();
  });
});

describe('tryInterpretBattery', () => {
  function buildBatteryPayload(status: number, percent: number, microVolts: number): Uint8Array {
    const buf = new Uint8Array(6);
    buf[0] = status;
    buf[1] = percent;
    const dv = new DataView(buf.buffer);
    dv.setUint32(2, microVolts, /* littleEndian= */ false);
    return buf;
  }

  it('decodes a "full" 100% reading at 4.195 V', () => {
    const payload = buildBatteryPayload(0x02, 100, 4_195_000);
    const result = tryInterpretBattery(payload);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('full');
    expect(result!.percent).toBe(100);
    expect(result!.voltageMicroV).toBe(4_195_000);
  });

  it('decodes a charging state', () => {
    const payload = buildBatteryPayload(1, 67, 3_900_000);
    expect(tryInterpretBattery(payload)!.status).toBe('charging');
  });

  it('decodes idle (on-battery)', () => {
    const payload = buildBatteryPayload(0, 45, 3_700_000);
    expect(tryInterpretBattery(payload)!.status).toBe('idle');
  });

  it('rejects invalid percentages', () => {
    expect(tryInterpretBattery(buildBatteryPayload(0, 150, 4_000_000))).toBeNull();
  });

  it('returns null for short payloads', () => {
    expect(tryInterpretBattery(new Uint8Array(5))).toBeNull();
  });
});
