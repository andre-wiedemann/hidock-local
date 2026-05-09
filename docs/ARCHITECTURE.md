# Architecture

This document is a guided tour of the source tree — what lives where, why it's split that way, and how a click in the UI ends up as bytes on the wire.

## High-level layout

```
hidock-local/
├── src/
│   ├── main/         Electron main process
│   ├── preload/      contextBridge (intentionally tiny)
│   ├── renderer/     Where the WebUSB conversation actually happens
│   └── shared/       Constants used across processes
├── tests/            Vitest unit tests + byte fixtures
└── out/              Build output (electron-vite + electron-builder)
```

Three Electron processes are involved at runtime:

1. **Main** — owns the BrowserWindow lifecycle and grants USB permissions.
2. **Preload** — exposes a small `window.hidock` object to the renderer; doesn't proxy USB.
3. **Renderer** — WebUSB lives here. All the protocol logic, all the UI.

All the interesting code is in the renderer. The main process is ~120 lines and the preload is <10.

## Why WebUSB lives in the renderer (not main)

Electron exposes USB through both the renderer's WebUSB API and the main process's `usb` module. Putting it in the renderer means:

- Same code path that runs in Chrome runs in Electron — useful for keeping a browser-only fallback alive.
- No IPC marshalling for protocol bytes (which are large during downloads).
- Easier to debug with the existing DevTools.

The trade-off is that we depend on Electron's USB permission grant in `src/main/index.ts`. That's a single function call, so it's a fine trade.

## Renderer module map

```
src/renderer/src/
├── main.ts                 Entry — boots app.ts on DOMContentLoaded
├── app.ts                  Wires button handlers, lifecycle, settings
├── state.ts                Global state object (device, files, prefs)
├── styles.css              Dark theme — ported verbatim from the original
├── downloader.ts           Orchestrates single + batch + ZIP download flows
├── usb/
│   ├── transport.ts        Open / claim / close / pairing
│   ├── protocol.ts         buildCommandPacket, sendCommand, constants
│   ├── parsers.ts          File-list, storage-info, chunk-stripper (PURE)
│   └── commands.ts         Higher-level: listFiles, downloadFile, getStorage
├── storage/
│   ├── settings.ts         localStorage persistence for user prefs
│   └── persistence.ts      savedFiles map, file-list cache, IDB helpers
├── ui/
│   ├── connection.ts       Connection status pill
│   ├── storage-panel.ts    Used / total / % bar
│   ├── transfer.ts         Progress bar, speed, ETA
│   ├── file-list.ts        Day-grouped recording list, selection, filtering
│   ├── save-target.ts      "Choose Folder" flow + dirHandle restore
│   ├── saved-files-panel.ts  Appended row per saved file
│   ├── preview.ts          In-app audio player
│   └── log.ts              Debug log panel
└── util/
    ├── filename.ts         Timestamp parsing, day grouping, .mp3 ext
    ├── format.ts           Byte / duration formatters
    └── speed-tracker.ts    Rolling-window byte-rate
```

The split is **layered**, with imports only flowing one way:

```
main.ts → app.ts → downloader.ts ─┐
                ↓                  ↓
             ui/*.ts            usb/*.ts
                ↓                  ↓
           storage/*.ts        util/*.ts
                ↓
             state.ts
```

Specifically:
- **`util/`** depends on nothing else. Pure functions.
- **`storage/`** depends on nothing else. Pure persistence.
- **`usb/parsers.ts`** depends on nothing else. Pure byte logic — easiest to unit-test.
- **`usb/protocol.ts`, `usb/transport.ts`, `usb/commands.ts`** depend on `shared/types.ts` and each other. They never touch the DOM.
- **`ui/`** modules each own one panel. They depend on `state.ts`, `usb/`, and `util/`.
- **`downloader.ts`** glues the USB layer to the UI for the actual download flows.
- **`app.ts`** is the only place that wires DOM events to handlers. Everyone else exports functions and waits to be called.

Adding a new feature usually fits in one of three patterns:

| Feature shape                 | Where it goes                              |
|-------------------------------|--------------------------------------------|
| New device command            | `usb/commands.ts` + parser if needed       |
| New panel / new UI surface    | New file in `ui/`, wired from `app.ts`     |
| New persisted preference      | Field in `storage/settings.ts`             |

## State management

There's no React, no Zustand, no observable framework. The renderer is a single `state.ts` object passed around by reference, plus targeted DOM mutations from the `ui/` modules.

```ts
// state.ts
export const state: AppState = {
  device: null,
  files: [],
  dirHandle: null,
  savedFiles: loadSavedFiles(),
  stopRequested: false,
  ...
};
```

Mutating state and re-rendering is the caller's responsibility — most flows mutate `state.files` and call a specific UI function (`renderFileList()`, `updateRow(file, 'success')`, `updateProgress(...)`).

This is simpler than a framework for an app this size, and keeps the renderer bundle small (~200 KB minified, mostly JSZip).

## Data flow: "user clicks Download Selected"

1. `app.ts` button handler reads `state.files.filter(f => f.selected)` and applies the Skip Saved filter.
2. Calls `downloader.downloadAllOrZip(toDownload)`.
3. `downloader.ts` checks if `state.dirHandle` is set:
   - **Yes** → `downloadStreamToFolder(files)` writes each file to disk as it finishes.
   - **No, single file** → `downloadSingle(file)` (no ZIP path).
   - **No, multiple files** → in-memory JSZip path.
4. For each file, `downloader.pullBytes(file)` calls `usb/commands.downloadFile(...)`.
5. `usb/commands.ts` runs the prep handshake, sends the command, and reads chunks. Every chunk goes through `parsers.stripChunkHeader` before being accumulated.
6. The accumulated `Uint8Array` becomes a `Blob`, which `ui/saved-files-panel.presentSaveableBlob` either writes to disk (via the dirHandle) or surfaces as a download link.
7. `markSaved(filename)` updates `state.savedFiles` and `localStorage`.

There are no IPC calls along this path. The renderer talks to the device directly.

## Build pipeline

`electron-vite` orchestrates three Vite builds:

| Build       | Source             | Output           | Format |
|-------------|--------------------|------------------|--------|
| `main`      | `src/main/`        | `out/main/`      | CJS    |
| `preload`   | `src/preload/`     | `out/preload/`   | CJS    |
| `renderer`  | `src/renderer/`    | `out/renderer/`  | ESM    |

`electron-builder` then takes `out/` and produces a packaged `.dmg` / `.exe` / `.AppImage` based on `electron-builder.yml`.

Hot reload during development:
- Renderer reloads on save (Vite HMR).
- Main process changes require a `Cmd+R` reload of the Electron window.

## Why it's not React

For a single-window utility with ~10 panels and one large list, React would add ~120 KB to the bundle, force a virtual-DOM diff on every chunk-progress event, and complicate the WebUSB transfer loop with effect dependencies.

The hand-rolled DOM updates here are uglier per-line but cheaper to reason about for the actual hot path (the chunk-read loop fires every ~50 ms during a download).

If the UI grows past ~3 routes or starts to need genuine reactivity, this is the first thing to revisit.
