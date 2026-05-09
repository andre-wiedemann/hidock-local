# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Local transcription via whisper.cpp.** Bundled `whisper-cli` per platform (built from pinned source v1.7.4 in CI), runs entirely on-device. Three trigger paths: per-row T button, auto-transcribe toggle, and a manual flow with live progress in the transfer panel.
- **Models manager.** New Transcription panel lists 10 ggml models (tiny → large-v3) with size, status, and one-click download / set-default / delete. Models are streamed from Hugging Face with progress + cancellation, stored under userData.
- **Output format selection.** Per-file outputs land as `<name>.txt`, `<name>.vtt`, `<name>.json` next to the MP3 — toggle each format independently. Optional language hint or auto-detect.
- **Auto-transcribe queue.** Batch downloads with auto-transcribe enabled run one transcription at a time, so RAM/GPU usage stays predictable.

### Changed
- electron-builder.yml now bundles `resources/whisper/**` (asar-unpacked so binaries can run).
- CI + release workflows cache the whisper.cpp build per `(os, arch, version)` to avoid rebuilding on every run.

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
