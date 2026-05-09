# Device Notes — HiDock P1

Everything you might want to know about the device that isn't part of the wire protocol itself.

## Hardware

- USB Vendor ID `0x10D6` — Actions Semiconductor
- USB Product ID `0xB00E`
- USB 2.0 full-speed (12 Mbps) — *not* high-speed, so transfer caps around ~1 MB/s in practice
- 64 GB internal storage (verified on the author's unit; the protocol's reported total can be parsed for any size in the 100 MB – 256 GB range)

The "P1" in the name is the only model this app targets. Other HiDock variants likely speak similar but not identical protocols. If you have one and want to test, open an issue.

## File format

Despite the `.hda` extension, recordings are **plain MP3**:

- MPEG-1 Layer III
- 48 kHz, mono, 96 kbps CBR
- ID3 tags absent (the device doesn't write them)
- Trailer: 16-byte ASCII `HiDockVM\0\0\0\0\0\0\0\0` at the end of every file

The `.hda` extension exists because that's what the official HiDock companion software writes. The bytes are MP3. Renaming `.hda` → `.mp3` is enough for any audio tool to open the file. This app does that automatically when "Save as .mp3" is enabled (the default).

### Why it looked encrypted

Older diagnostic notes (and the original HiDock companion code) called the format "encrypted HDA" or noted it had "high entropy that suggests encryption". Both were wrong. The actual cause was a download-loop bug:

The device frames the download response in 8192-byte chunks, each prefixed with a 12-byte protocol header (`12 34 00 05 00 00 00 59 00 00 1F F4`). Code that stripped this header from only the first chunk left 12 bytes of garbage every 8192 bytes throughout the file. Those embedded bytes destroyed MP3 framing and pushed the file's entropy to ~7.77 / 8 — looking enough like ciphertext to fool entropy-based format detectors.

Fix: strip the 12-byte header from every chunk. See `src/renderer/src/usb/parsers.ts:stripChunkHeader`.

## Filename schemes

The device uses one of two formats depending on firmware version:

```
REC_20260429_124411.hda          ← older firmware
2026Apr29-124411-Rec26.hda       ← current firmware (2026-05)
```

Both encode the same fields: year, month, day, HH:MM:SS. The current app handles both via `src/renderer/src/util/filename.ts:fileTimestampKey`.

## Storage layout

Reported by the firmware via `0x00 0x10`:

- Block size: **2048 bytes** (not 512, despite what 512-block heuristics would suggest)
- Used / total reported as block counts, multiply by 2048 for bytes
- ASCII `HIDOCK` magic at offset 16 of the response payload — anchor on this when parsing

For a 64 GB device:
- Total blocks = 33,554,432
- Total bytes = 33,554,432 × 2048 = 68,719,476,736 = 64 GiB exactly

## File-list quirk: truncated tail

The HiDock's file-list command (`0x00 0x04`, `param=0x0E`) does not always
return the device's full inventory in one call. We've observed three
distinct counts against the same physical recordings:

- **Vendor app (HiNotes)**: 224 entries
- **Standalone HTML** (`open-notes/.../batch-download-multi-zip.html`): 223
  entries on the first call after page load, 214 on every subsequent
  call within the same session
- **HiDock Local (this app)**: 214 entries consistently

The correlation that reproduces every time:
- When `STORAGE_INFO` (`0x00 0x10`, `param=3`) returns valid bytes, the
  next `FILE_LIST` returns the longer (223+) list.
- When `STORAGE_INFO` times out, `FILE_LIST` returns 214.

The vendor app sidesteps this by issuing a longer init sequence before
ever asking for the file list — observed in their devtools log:

```
get-time           → "2026-05-09 17:31:53"
set-time-to        → host clock
get-settings       → autoRecord/autoPlay/...
get-recording-quality
get-card-info      → free/used/capacity (their version of STORAGE_INFO)
battery-status
... more init commands ...
file-list          → count: 224, time: 98ms
```

We don't currently have the byte-level decoding for `get-time`,
`set-time-to`, `get-settings`, etc., so we can't replicate the full
init. Experiments to coax the device into the "long-list" state from
the renderer side (drain the IN endpoint, USB reset, double-call,
re-order command sequences, swap `readSize`) all either had no effect
or made things worse — the device's protocol state machine is brittle
and breaks on any divergence from "claim → STORAGE_INIT/INFO → FILE_LIST".

### Workaround

If you notice missing recordings (the day groups in the file list
don't match what's on the device's own screen), unplug the HiDock for
~5 seconds and plug it back in. The first `FILE_LIST` after a fresh
USB enumeration is more likely to land in the "long-list" state and
return everything.

If that doesn't help, opening the standalone HTML in Chrome
(`python3 -m http.server` then load the page) and clicking List Files
once will pull the full list there — those recordings can be
downloaded from the standalone in the meantime.

A proper fix requires reverse-engineering the missing init commands
the vendor app uses. Tracked separately on the protocol-re branch.

## Recording behavior

Observed empirically:

- The device records continuously when in record mode (no auto-split on silence)
- Files are sealed at the moment recording stops; mid-recording reads aren't possible
- Stopping and restarting recording within ~1 second creates two separate files (no concatenation)
- The device doesn't expose any file-rename or file-delete commands over USB — at least none I've found. To delete recordings, you have to use the device's physical UI.

## MacWhisper / external tool compatibility

Files produced by this app are immediately usable in:

- **MacWhisper** — drop a `.mp3` from the chosen folder onto the dock icon
- **Audacity** — File → Import → Audio
- **VLC** — open directly
- **ffprobe** — verifies as `mp3, 48000 Hz, mono, 96 kb/s`

If MacWhisper rejects the file, it's almost certainly a download-loop bug — verify with `ffprobe` that the duration is non-zero and the bitrate is sane. A file with 12-byte garbage every 8192 bytes will sometimes still play in VLC (which is forgiving) but show as ~0:00 duration in MacWhisper.

## Rescuing files damaged by older code

If you have `.hda` files from before the per-chunk header fix, you can rescue them with this Python script:

```python
import sys
from pathlib import Path

CHUNK = 8192
HEADER = bytes([0x12, 0x34, 0x00, 0x05])
HEADER_LEN = 12

def rescue(path: Path) -> None:
    data = path.read_bytes()
    out = bytearray()
    pos = 0
    while pos < len(data):
        # Each 8192-byte block in the broken file starts with the 12-byte
        # header that should have been stripped.
        block = data[pos:pos + CHUNK]
        if block.startswith(HEADER):
            out.extend(block[HEADER_LEN:])
        else:
            out.extend(block)
        pos += CHUNK
    fixed = path.with_suffix('.mp3')
    fixed.write_bytes(bytes(out))
    print(f"{path.name} → {fixed.name} ({len(out)} bytes)")

for arg in sys.argv[1:]:
    rescue(Path(arg))
```

Usage: `python3 rescue.py *.hda`

This is a one-shot tool, not part of the app. If you're using a current build of HiDock Local, your downloads are already correct and you don't need this.
