# HiDock Local

Vendor-free, cloud-free desktop tool for the **HiDock P1** voice recorder.

Pulls recordings off the device over USB without going through the manufacturer's cloud or any other intermediary. Files land directly on your disk, in a folder you choose, as plain `.mp3` you can hand straight to MacWhisper or any other audio tool.

> **Status:** functional, single-developer hobby project. Used in production by the author against a 64 GB HiDock P1 since 2026-04. Open-sourced 2026-05.

## Why

The official HiDock companion software requires a vendor account, sends recordings through the cloud for transcription, and treats the device as if it can't function without their service.

It can. The recordings are plain MP3 once you strip the chunk framing (see [`docs/USB_PROTOCOL.md`](docs/USB_PROTOCOL.md)). This app does only that.

## What it does

- **Connects** to a HiDock P1 over WebUSB (no drivers, no kernel extensions)
- **Lists** recordings on the device, grouped by day, sorted latest-first
- **Downloads** selected recordings straight to a folder you pick — no ZIPs, no in-memory accumulation, no cloud roundtrip
- **Names** them `.mp3` so MacWhisper / VLC / Audacity recognize them out of the box
- **Remembers** which files you've already pulled so you can re-run after adding new recordings without re-downloading old ones
- **Previews** any recording by streaming it to a built-in audio player without committing to disk
- **Auto-reconnects** when you plug the device back in
- **Reports** disk usage on the device (used / total / %)

What it intentionally doesn't do: transcribe, summarize, sync, log telemetry, or talk to anything that isn't your HiDock.

## Install

### From source (only path right now)

```bash
git clone https://github.com/andre-wiedemann/hidock-local.git
cd hidock-local
npm install
npm run dev
```

You need:
- Node 20+
- A HiDock P1 connected via USB
- macOS, Windows, or Linux (Electron runs everywhere)

### Pre-built binaries

Not yet — see [Roadmap](#roadmap).

## Quickstart

1. Plug in the HiDock P1
2. Run `npm run dev`
3. Click **Connect** in the app, pick the HiDock from the device picker
4. Click **Choose Folder…** and pick where you want recordings to land
5. Click **Download All** — files stream straight to disk as `.mp3`

That's it. Re-run any time; already-downloaded files are marked and skipped automatically (toggle in the file controls).

## Architecture

```
src/
├── main/              Electron main process (window, USB permissions)
├── preload/           contextBridge — minimal
├── renderer/          The actual UI (WebUSB lives here)
│   ├── index.html
│   └── src/
│       ├── usb/       Protocol, transport, command implementations
│       ├── storage/   localStorage + IndexedDB persistence
│       ├── ui/        DOM modules per panel
│       ├── util/      Filename / size / speed-rate helpers
│       ├── app.ts     Top-level wiring
│       └── main.ts    Entry point
└── shared/            Constants used in both main and renderer
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a walk-through of the module map and data flow.

## Documentation

- **[USB Protocol](docs/USB_PROTOCOL.md)** — full spec for the HiDock P1 wire protocol. Self-contained: you can implement a clone of this app from this doc alone, no need to reference any other repo.
- **[Architecture](docs/ARCHITECTURE.md)** — module layout, data flow, where to put a new feature
- **[Development](docs/DEVELOPMENT.md)** — npm scripts, debugging tips, packaging
- **[Device Notes](docs/DEVICE_NOTES.md)** — HiDock P1 specifics, file format, MacWhisper compatibility

## Roadmap

The shape of the next few things to land:

- Pre-built binaries for macOS / Windows / Linux
- App icon (currently a placeholder)
- Optional automatic transcription via local Whisper.cpp (off by default)
- Possibly support for the HiDock H1 if anyone with one wants to test

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

The protocol verification and the per-chunk-header bug fix were figured out the hard way against André's hardware between 2026-04 and 2026-05. The original HiDock companion code referenced its own `.hda` format as encrypted — it's not, that was a download-loop bug. See `docs/USB_PROTOCOL.md` for the full story.

This project has no affiliation with HiDock, Actions Semiconductor, or any related entity.
