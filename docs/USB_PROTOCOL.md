# HiDock P1 USB Protocol

This document is a self-contained reference for the HiDock P1 voice recorder's USB protocol, verified against live firmware as of 2026-05. Everything you need to talk to the device — from initial enumeration to pulling a file off it — is described here. No external references required.

If something here disagrees with the code in `src/renderer/src/usb/`, the code is the source of truth and this doc is wrong; please open an issue.

---

## 1. Device identification

| Field           | Value                                                  |
|-----------------|--------------------------------------------------------|
| Vendor ID       | `0x10D6` (Actions Semiconductor)                       |
| Product ID      | `0xB00E`                                               |
| Class           | Vendor-specific                                        |
| Configurations  | 1                                                      |
| Interfaces      | 1 (interface 0)                                        |
| Endpoints       | OUT bulk on `0x01`, IN bulk on `0x82` (logical 1 / 2)  |
| Max packet size | 64 bytes (per USB 2.0 full-speed)                      |

Open the device, select configuration 1, claim interface 0. WebUSB:

```js
const dev = await navigator.usb.requestDevice({
  filters: [{ vendorId: 0x10d6, productId: 0xb00e }]
});
await dev.open();
await dev.selectConfiguration(1);
await dev.claimInterface(0);
```

---

## 2. Command frame format

Every host→device command starts with the same 12-byte frame:

```
offset  size   description
------  ----   -----------------------------------------------------------
0..1    2      Magic bytes:  0x12 0x34
2       1      cmd1 — group  (0x00 = system, 0x10 = storage)
3       1      cmd2 — sub-command within the group
4..7    4      param1 region (little-endian uint32 in byte 4)
8..11   4      param2 region (little-endian uint32 in byte 8)
12..    N      Optional payload (filename for downloads, etc.)
```

### 2.1 The "param-in-byte-7" wrinkle

For four specific commands, `param1` lives at **byte 7** instead of byte 4:

- `0x00 0x01` — Device info
- `0x00 0x04` — File list
- `0x00 0x10` — Storage info
- `0x10 0x04` — Storage init

For these, the byte-4 layout is:

```
[4..6: 0x00 0x00 0x00]
[7:    param1 & 0xFF]
[8..11: 0x00 0x00 0x00 0x00]
```

If you put `param1` at byte 4 for these commands, the device returns no data. This was discovered by reading the original HiDock companion source.

### 2.2 Endianness

The protocol is **little-endian almost everywhere** with one critical exception: the size field in file-list records is **big-endian** (see §4.2). Don't assume LE without checking.

---

## 3. Commands

### 3.1 Device info — `0x00 0x01`

Returns the standard 12-byte response header followed by version and serial bytes. Useful as a liveness check.

```
TX: 12 34 00 01 00 00 00 00 00 00 00 00
RX: 12 34 00 01 00 00 00 NN <payload>
```

The payload format isn't documented here because we don't currently need it — the file-list and download commands are sufficient for the rescue use case.

### 3.2 File list — `0x00 0x04`, `param1 = 0x0E`

Lists recordings on the device. Param `0x0E` goes in byte 7, not byte 4.

```
TX: 12 34 00 04 00 00 00 0E 00 00 00 00
```

The response can span multiple chunks (typically up to 32 KB total for ~250 entries). Read until you get a short read (`< 512` bytes) or hit your buffer cap.

After the 12-byte response header, the body is a stream of variable-length records. See §4 for the record layout.

### 3.3 Download file — `0x00 0x05`

Pull a single recording's bytes off the device.

**Step 1: prep handshake.** Send this exact 12-byte sequence first:

```
TX: 12 34 00 0B 00 00 00 58 00 00 00 00
```

The device may or may not reply — read with a short timeout (1s) and discard whatever comes back. The handshake itself is what matters.

**Step 2: wait ~100 ms** for the device to settle.

**Step 3: send the download command** with the filename as payload:

```
TX:  12 34 00 05 00 00 00 59 00 00 00 LL <filename bytes>
     │  │  │  │  │  │  │  │  │  │  │  │
     │  │  │  │  └──────────────┘  │  └─ filename length (1 byte)
     │  │  │  │   zero padding     │
     │  │  │  │                    │
     │  │  │  └─ SUBCMD_DOWNLOAD_FILE
     │  │  └─── CMD_GROUP_SYSTEM
     │  │
     └──┴──── Magic
```

**Step 4: read the response in 8192-byte chunks.** Each chunk is framed:

```
[12-byte protocol header]  +  [up to 8180 bytes of payload]
```

The header is always:

```
12 34 00 05 00 00 00 59 00 00 1F F4
                                ^^^^^
                                0x1FF4 = 8180 = payload length
```

**You must strip these 12 bytes from every chunk, not just the first.**

The payload, once concatenated, is plain MP3 (MPEG-1 Layer III, 48 kHz mono, 96 kbps). Each file ends with a 16-byte ASCII trailer `HiDockVM\0\0\0\0\0\0\0\0` — leave it in or strip it; players ignore it.

**Stop conditions** for the chunk-read loop:
- Three consecutive empty / timed-out reads → done
- Any read returning < 8192 bytes after a header strip → done
- Hard cap (`MAX_CHUNKS = 500_000`) as belt-and-suspenders

**Why the per-chunk header matters.** Earlier code that stripped only chunk #0 left 12 bytes of garbage every 8192 bytes throughout the output. Those embedded bytes destroyed the MP3 framing and pushed the file's entropy to ~7.77/8 — looking enough like ciphertext that older HiDock companion docs labeled the format "encrypted HDA". It isn't encrypted. It's just a download-loop bug.

### 3.4 Storage info — `0x00 0x10`, `param1 = 3`

Reports used and total storage capacity. **Send `STORAGE_INIT` first** (see §3.5), then this command.

```
TX prep:  12 34 10 04 00 00 00 03 00 00 00 00   (STORAGE_INIT)
TX:       12 34 00 10 00 00 00 03 00 00 00 00   (STORAGE_INFO)
```

Response: 12-byte header + 28-byte payload (see §4.3 for layout).

If the device returns no data (sometimes happens after rapid command sequences), retry up to 3 times with `STORAGE_INIT` re-sent each round and a 250 ms wait between attempts.

### 3.5 Storage init — `0x10 0x04`, `param1 = 3`

Required priming command before storage info. Same as above — param goes in byte 7.

```
TX:  12 34 10 04 00 00 00 03 00 00 00 00
```

The response (if any) can be ignored; the side effect of this command is what matters.

---

## 4. Response payload formats

### 4.1 Standard 12-byte response header

Every response starts with a 12-byte header echoing the command identifiers and indicating payload length somewhere. The body of useful information starts at byte 12.

For our purposes, just slice the first 12 bytes off and parse the rest.

### 4.2 File-list record format

Each record in the file-list response body has this layout:

```
offset   size   description
------   ----   -----------------------------------------------------------
0..3     4      Delimiter:  05 00 00 1B
4..N     N      Filename, ASCII (no null terminator yet)
N+1      1      Padding:  00
N+2      4      Size, big-endian uint32, in bytes  ← NB: big-endian
N+6      6      Padding:  00 00 00 00 00 00
N+12     11     Hash / UUID
N+23     4      Field B (possibly an mtime)
N+27     1      Unknown byte
```

**Verified bytes from a real device (2026-05):**

| Filename                          | Size bytes (BE) | Decoded     | Actual on disk    |
|-----------------------------------|-----------------|-------------|-------------------|
| `2026Apr29-101546-Rec25.hda`      | `02 4E 7F 6C`   | 38,766,956  | 38,738,736 (±28K) |
| `2026Apr29-124411-Rec26.hda`      | `0A 4C 49 CC`   | 172,771,788 | 173,024,740 (±253K) |

The small discrepancy between reported size and on-disk size is the per-file MP3 trailer + frame alignment — within ±0.2%.

**Two filename schemes** are used by current firmware:

- `REC_YYYYMMDD_HHMMSS.hda` — older firmware
- `YYYYMonDD-HHMMSS-RecNN.hda` — current (e.g. `2026Apr29-124411-Rec26.hda`)

A single regex covers both:

```
/(REC_\d{8}_\d{6}\.hda|\d{4}[A-Za-z]{3}\d{2}-\d{6}-Rec\d+\.hda)/gi
```

### 4.3 Storage-info payload format

The 28-byte payload after the 12-byte response header:

```
offset   size   description
------   ----   -----------------------------------------------------------
0..3     4      Firmware metadata (varies, possibly mtime)
4..7     4      Firmware metadata
8..11    4      Used blocks   (LE uint32)  ← multiply by 2048 for bytes
12..15   4      Total blocks  (LE uint32)  ← multiply by 2048 for bytes
16..21   6      ASCII "HIDOCK" — format fingerprint
22..27   6      Zero padding
```

**Block size is 2048 bytes**, not 512. On a 64 GB device:
`33,554,432 × 2048 = 68,719,476,736 = 64 GiB exactly`

The `HIDOCK` magic at offset 16 is the anchor — verify it before trusting the offsets. If it's missing, the firmware variant is different and you should fall back to a heuristic (try several offset/unit combinations until you land in the plausible 100 MB – 256 GB range).

---

## 5. File format on disk

Files arrive named `*.hda`. Once you've stripped the per-chunk protocol headers (see §3.3), the bytes are **plain MP3** — MPEG-1 Layer III, 48 kHz mono, 96 kbps. Rename `.hda` → `.mp3` and any audio tool will open them.

Each file ends with the 16-byte ASCII trailer `HiDockVM\0\0\0\0\0\0\0\0`. MP3 decoders ignore trailing garbage, so you don't have to strip it; this app leaves it in.

---

## 6. Reference implementation

The canonical implementation of every command and parser in this document lives in `src/renderer/src/usb/`:

- `protocol.ts` — `buildCommandPacket`, `sendCommand`, magic byte constants
- `transport.ts` — pairing, open, claim, close
- `parsers.ts` — `parseFileListResponse`, `tryInterpretStorage`, `stripChunkHeader`
- `commands.ts` — `listFiles`, `getStorageInfo`, `downloadFile`

Unit tests for the parsers live in `tests/parsers/`. They use real captured byte sequences from a live device, so if you're porting this protocol to a different stack, those fixtures plus this doc are enough.

---

## 7. Known unknowns

Things this doc doesn't cover because we haven't needed them yet:

- The exact format of the device-info response payload (`0x00 0x01`)
- Field B in the file-list record (currently believed to be a timestamp)
- The 11-byte hash field in file-list records
- Any commands beyond the four documented above

PRs adding any of these (with verified bytes) are welcome.
