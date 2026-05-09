# Contributing

Thanks for considering a contribution. This is a small, single-purpose project, so before opening a big PR please check that the work fits the scope below.

## Scope

**In scope:**
- Bug fixes
- HiDock P1 protocol additions or corrections (with verified bytes from a real device)
- UX improvements to the existing flow (filtering, sorting, accessibility)
- Build / packaging fixes
- Documentation improvements

**Out of scope (without prior discussion):**
- Cloud features, telemetry, account systems, syncing
- Transcription / summarization integrations
- Support for non-HiDock devices
- Mobile builds (WebUSB is desktop-Chromium only)

If you're not sure, open an issue first.

## Development setup

```bash
git clone https://github.com/andre-wiedemann/hidock-local.git
cd hidock-local
npm install
npm run dev    # launches Electron with hot-reload
```

Useful scripts:

| Script              | What it does                                |
|---------------------|---------------------------------------------|
| `npm run dev`       | Launch Electron in development mode         |
| `npm run typecheck` | TypeScript checks for main + renderer       |
| `npm test`          | Run the Vitest suite (parser unit tests)    |
| `npm run build`     | Production build — outputs to `out/`        |
| `npm run package`   | Build + electron-builder (unpacked)         |
| `npm run package:mac` / `package:win` / `package:linux` | Platform-specific builds |

## Code conventions

- **TypeScript everywhere.** No untyped JavaScript except inside JSON config.
- **No comments that just describe what the code does.** Comments should explain *why* — a hidden constraint, a workaround for a known device quirk, a wire-protocol detail you can't see from the bytes.
- **Modules under ~250 lines.** If a file gets bigger, it's probably doing two things — split it.
- **No new dependencies without justification.** This app keeps its install size small and audit-able.

## Protocol changes

If you're touching `src/renderer/src/usb/`:

1. Verify any new byte layout against a real device — paste a hex dump of the relevant response into the PR description.
2. Update `docs/USB_PROTOCOL.md` to match. The protocol doc is the canonical reference; if the code disagrees with it, the code is wrong.
3. Add a unit test fixture under `tests/fixtures/` if you're adding a new parser path.

## Pull requests

- One feature / fix per PR. Don't bundle a refactor with a behavior change.
- Run `npm run typecheck && npm test` before pushing.
- If you change the user-facing behavior, update `CHANGELOG.md` under `[Unreleased]`.

## License

By contributing, you agree your contributions are licensed under the same MIT license as the project.
