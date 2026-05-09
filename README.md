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

Each tagged release publishes unsigned binaries for all three platforms — see the [Releases page](https://github.com/andre-wiedemann/hidock-local/releases).

| Platform   | Artifact            |
|------------|---------------------|
| macOS      | `HiDock-Local-x.y.z.dmg` (Intel + Apple Silicon) |
| Windows    | `HiDock-Local-Setup-x.y.z.exe` |
| Linux      | `HiDock-Local-x.y.z.AppImage` |

#### Installing the unsigned binary

Because the project doesn't have an Apple Developer or Windows code-signing cert, your OS will warn on first launch. The binaries are safe — the build pipeline runs entirely on GitHub Actions and you can audit the source it built from. Override steps:

**macOS** — open the `.dmg`, drag HiDock Local into Applications. The first time you launch it:
1. Right-click (or Ctrl-click) the app icon → **Open**
2. Click **Open** in the "unidentified developer" prompt
3. macOS remembers the choice; subsequent launches are normal

If macOS still refuses (Apple Silicon, recent Sequoia versions), run once from a terminal to clear the quarantine attribute:
```bash
xattr -cr /Applications/HiDock\ Local.app
```

**Windows** — run the installer. SmartScreen will show "Windows protected your PC":
1. Click **More info**
2. Click **Run anyway**

**Linux** — make the AppImage executable and run it:
```bash
chmod +x HiDock-Local-*.AppImage
./HiDock-Local-*.AppImage
```

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

- Code signing + notarization once an Apple Developer cert is available (removes the first-launch warning on macOS)
- A nicer app icon (current one is a placeholder slash mark)
- Optional automatic transcription via local Whisper.cpp (off by default)
- Possibly support for the HiDock H1 if anyone with one wants to test

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

The protocol verification and the per-chunk-header bug fix were figured out the hard way against André's hardware between 2026-04 and 2026-05. The original HiDock companion code referenced its own `.hda` format as encrypted — it's not, that was a download-loop bug. See `docs/USB_PROTOCOL.md` for the full story.

This project has no affiliation with HiDock, Actions Semiconductor, or any related entity.
