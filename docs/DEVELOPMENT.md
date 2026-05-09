# Development

## Prerequisites

- **Node 20+** (use `nvm use` if you have nvm — see `.nvmrc`)
- A Chromium-based browser for reference (the app runs in Electron, but WebUSB testing in Chrome is sometimes useful)
- Optional: a HiDock P1 plugged in. The app launches without one — you'll just see "Not connected" until you plug a device in.

## Scripts

```bash
npm run dev            # Launch Electron in dev mode with HMR for the renderer
npm run typecheck      # tsc --noEmit on main + renderer
npm test               # Run Vitest unit tests (parsers)
npm run test:watch     # Re-run tests on save
npm run build          # Production build to out/
npm run icons          # Regenerate assets/icon.{icns,ico,png} from icon.svg
npm run whisper:fetch  # Build whisper.cpp from source for the current platform
npm run package        # Build + electron-builder --dir (unpacked)
npm run package:mac    # Build + macOS .dmg
npm run package:win    # Build + Windows .exe (NSIS)
npm run package:linux  # Build + Linux .AppImage
```

## One-time setup: whisper.cpp

Before you can run transcription locally, you need to build the whisper-cli
binary for your platform:

```bash
npm run whisper:fetch
```

This clones whisper.cpp at the pinned tag, builds it via CMake, and copies
the binary to `resources/whisper/<platform>-<arch>/whisper-cli`. The script
is idempotent — it skips if the binary already exists.

Requirements:
- **macOS**: Xcode CLT (`xcode-select --install`)
- **Linux**: `build-essential` and `cmake`
- **Windows**: Visual Studio Build Tools (with C++ workload) and `cmake`

Build time: 3–5 min on first run. The binary is ~2 MB on macOS arm64 and
links statically against ggml/whisper, so it's self-contained.

CI runners do this automatically on every release; for dev you only need
to run it once per machine (or after bumping `WHISPER_VERSION` in
`tools/fetch-whisper.mjs`).

## Running in development

```bash
npm install
npm run dev
```

`electron-vite` watches `src/main`, `src/preload`, and `src/renderer/`. Renderer changes hot-reload; main/preload changes require pressing `Cmd+R` in the open Electron window (the dev window has DevTools enabled and reload bound to `Cmd+R`).

## Where to put things

| Need to add…                         | Put it in                                    |
|--------------------------------------|----------------------------------------------|
| A new wire command                   | `src/renderer/src/usb/commands.ts`           |
| A new response parser                | `src/renderer/src/usb/parsers.ts` + a test  |
| A new persisted preference           | `src/renderer/src/storage/settings.ts`       |
| A new UI panel                       | New file in `src/renderer/src/ui/`           |
| Glue between UI and a download flow  | `src/renderer/src/downloader.ts`             |
| Cross-process constants              | `src/shared/types.ts`                        |

See `ARCHITECTURE.md` for the full module map.

## Debugging WebUSB inside Electron

Electron's renderer DevTools is the same Chromium DevTools you'd use in a browser, including the **chrome://device-log** equivalent: look at `Console` filtered to `Verbose` to see permission-handler decisions from the main process if you're getting unexpected disconnects.

For low-level USB tracing on macOS:

```bash
log stream --predicate 'subsystem == "com.apple.iokit.IOUSBHostFamily"' --info
```

For Linux:

```bash
sudo dmesg -w  # while plugging / unplugging
```

The on-screen Debug Log panel in the app shows every TX command and read result. Toggle it from the bottom of the window.

## Testing without a device

Most of the protocol logic is in pure parsers in `src/renderer/src/usb/parsers.ts`. The Vitest suite under `tests/parsers/` exercises these against real captured byte sequences in `tests/fixtures/`.

To add a new test fixture:

1. Capture a real response from your device using the in-app Debug Log
2. Save the raw bytes to `tests/fixtures/<name>.bin`
3. Add a test in `tests/parsers/` that loads the fixture with `readFileSync` and asserts on the parsed output

## Packaging caveats

- **Code signing**: The default `electron-builder.yml` doesn't sign or notarize. Building for distribution on macOS without an Apple Developer cert will produce an unsigned `.dmg` that Gatekeeper will quarantine. Set up `CSC_LINK` / `CSC_KEY_PASSWORD` env vars and `notarize: true` if you have a cert.
- **Auto-update**: Not configured. The `publish: null` setting in `electron-builder.yml` disables auto-update generation. If you want auto-update, point `publish` at a GitHub release or S3 bucket.
- **Icons**: `assets/icon.{icns,ico,png}` need to exist before packaging. There's a placeholder in the repo for development; replace it with a proper icon before shipping a release.

## Known dev-mode quirks

- The first `npm run dev` after pulling a fresh checkout takes ~30s to install Electron (~120 MB binary). Subsequent runs reuse the cache.
- On macOS, the very first connection prompt may take a moment to appear after clicking Connect — the OS is verifying the device descriptor. This is not a bug.
- WebUSB events (`usb.ondisconnect`) sometimes fire on a slight delay (~200 ms) after physical disconnect. The app shows "Device disconnected" on the next event tick.
