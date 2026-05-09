# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-09

Initial open-source release.

### Added
- Electron app shell with WebUSB pairing for VID `0x10D6` / PID `0xB00E` (HiDock P1)
- Connect / disconnect / auto-reconnect against the device
- File listing with day-grouped headers, latest-first sort, search filter, shift-range select, Cmd/Ctrl+A select-visible
- Per-file size display in the row + running total in the controls bar
- Direct-to-folder downloads via the File System Access API (no ZIP overhead, no in-memory accumulation)
- ZIP fallback path when no folder is chosen
- Per-file speed and ETA during transfer (rolling 2-second window)
- Audio preview — streams a recording from the device into an in-app `<audio>` element
- "Already saved" marker + Skip Saved toggle (persisted to localStorage)
- Per-file retry button on errored rows
- Settings persistence to localStorage (file extension preference, search filter, ZIP config)
- FileSystemDirectoryHandle persistence to IndexedDB across sessions
- File-list cache so the previous session's recording list shows immediately on launch
- Live device storage usage panel (used / total / %, anchored on the firmware's "HIDOCK" magic)

### Protocol findings consolidated from prior research
- File-list response: 4-byte size field is **big-endian** at `filename_end + 1`, not little-endian like the rest of the protocol
- Storage info: blocks are 2048 bytes, not 512; the firmware writes `HIDOCK` ASCII at offset 16 as a format fingerprint
- Download: every 8192-byte chunk is prefixed with a 12-byte protocol header that **must be stripped on every chunk**, not just the first — this was the root cause of the "encrypted HDA" red herring
