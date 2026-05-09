# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-05-09

### Added
- **Local transcription via whisper.cpp.** Bundled `whisper-cli` per platform (built from pinned source v1.7.4 in CI), runs entirely on-device. Three trigger paths: per-row T button, auto-transcribe toggle, and a manual flow with live progress in the transfer panel.
- **Models manager.** New Transcription panel lists 9 ggml models (tiny → large-v3) with size, status, and one-click download / set-default / delete. Models are streamed from Hugging Face with progress + cancellation, stored under userData. (`large-v3-turbo-q5_0` was pulled — produces empty transcriptions on whisper.cpp v1.7.4.)
- **In-app transcript viewer.** Collapsible Transcript panel shows the latest transcription text with filename + language + duration. Click `T` on a row that's already transcribed to view the existing `.txt` instead of re-running. Re-transcribe button on the panel re-runs against the current default model.
- **Output format selection.** Per-file outputs land as `<name>.txt`, `<name>.vtt`, `<name>.json` next to the MP3 — toggle each format independently. Optional language hint or auto-detect.
- **Single-worker queue for transcriptions.** Per-row clicks and auto-transcribe both feed the same queue, one inference at a time, so RAM/GPU usage stays predictable. Status line surfaces queue depth ("3 queued · 1 running").
- **Per-row Download button** (↓) that triggers a single-file pull without going through the bulk batch UI.
- **Per-row preview indicator.** When a recording is loaded in the mini-player, its row highlights and the Play button toggles between ▶ and ⏸ to mirror the audio state. Click the active row's button to play/pause without re-pulling from the device.
- **Saved-state reconciliation.** App reconciles `state.savedFiles` with what's actually on disk on every Choose Folder, every List Files, and on window focus — files deleted in Finder lose their "✓ Saved" badge automatically.
- **Path-based save folder persistence.** Replaces the FileSystemDirectoryHandle flow with a plain absolute path stored in localStorage; the chosen folder auto-restores at every launch with no permission re-grant prompt.
- **Collapsible panels.** Config and Transcription panels toggle via their headers, persisting collapse state to localStorage.

### Changed
- File-action buttons (List Files / Download All / Download Selected / Stop) moved out of Config into the Files panel.
- electron-builder.yml now bundles `resources/whisper/**` and `node_modules/ffmpeg-static/**`, both asar-unpacked.
- CI + release workflows cache the whisper.cpp build per `(os, arch, version)` to avoid rebuilding on every run.

### Fixed
- Per-chunk protocol header now stripped from every download chunk via a one-pass sweep over the assembled buffer (was only stripping the first chunk; rest left 12 bytes of garbage every 8192 bytes throughout the file). Saved MP3s now decode cleanly.
- Click-during-reload race condition that crashed `previewFile` with `Cannot read properties of undefined (reading 'name')`.

### Known limitations
- File-list response sometimes truncates by ~9 entries vs the vendor app (which sends a more complete device-init sequence before requesting the file list). The standalone HTML in `open-notes/hidock-companion/scripts/` exhibits the same truncation on subsequent List Files calls. See `docs/DEVICE_NOTES.md` for the workaround.

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
