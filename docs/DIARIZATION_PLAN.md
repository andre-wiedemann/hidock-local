# Diarization Plan — Active Feature Doc

This doc is the working spec for the speaker-identification feature on
branch `feat/diarization`. It exists so a fresh Claude Code session can
pick up the work without re-deriving context. Delete it when the
feature ships.

## State as of last session (2026-05-09)

- **Branch**: `feat/diarization` off `main` (created from commit
  `b3e5764` — the v0.2.1 release tag).
- **Last commit**: `d81f42c` — *"Add sherpa-onnx fetch step + bundling
  for diarization"*. Build infrastructure only; no runtime integration
  yet.
- **What works locally**: `npm run sherpa:fetch` downloads the
  sherpa-onnx v1.13.1 prebuilt static-link tarball for the current
  platform, extracts the `sherpa-onnx-offline-speaker-diarization`
  binary into `resources/sherpa/<platform-arch>/`. Verified on
  darwin-arm64 (24 MB binary, runs, prints help).
- **What does not work yet**: nothing in `src/` knows about diarization.
  The runtime pipeline still ends after whisper-cli.

## Architecture (decided, do not re-litigate)

- **Engine**: sherpa-onnx (offline, ONNX-based, single static binary,
  no Python). `sherpa-onnx-offline-speaker-diarization` is the CLI we
  wrap. Same packaging story as whisper-cli: per-platform binary in
  `resources/sherpa/<plat-arch>/`, bundled via `electron-builder.yml`
  (`asarUnpack: resources/**`), resolved at runtime by a
  `findSherpaBinary()` helper that mirrors `src/main/whisper/binary.ts`.
- **Models** (two are required by the diarization CLI):
  1. **Segmentation** — `sherpa-onnx-pyannote-segmentation-3-0`
     (~6 MB). Detects speaker-change boundaries.
  2. **Embedding** — start with
     `wespeaker_en_voxceleb_resnet34` (~26 MB, English-trained but
     embedding is largely language-agnostic for diarization). Later we
     can offer `3dspeaker_speech_eres2net_*` as alternates.
  - Models live alongside the existing whisper ggml models. Extend
    `src/main/whisper/models.ts` + `catalog.ts` with the two new
    entries (or split into `src/main/sherpa/models.ts` if cleaner).
  - HuggingFace / sherpa-onnx releases host them. Catalog URLs:
    - segmentation: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`
    - embedding: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx`
    (note the typo "recongition" in the upstream tag — it's intentional
    on their end, leave as-is)
- **Pipeline placement**: the diarization step runs **after** whisper
  finishes, on the same 16 kHz mono WAV that whisper consumed. We
  already have that WAV in the request-scoped temp dir. Reusing it is
  free.
- **Merge strategy**: each whisper segment gets the speaker label of
  whichever sherpa segment overlaps it most. Threshold 50% — below
  that, fall back to the previous segment's speaker. Single-speaker
  recordings (clustering returns one cluster) suppress labels entirely
  in the rendered output.
- **Output formats**:
  - `.txt` — `Speaker 1: <text>\n\nSpeaker 2: <text>\n\n…`
  - `.vtt` — real WebVTT voice tags: `<v Speaker 1>text</v>`
  - `.json` — add `speaker: number` to each segment
- **UX**: a "Detect speakers" toggle next to the language hint in the
  Transcription panel (renderer). Off by default (extra ~5 MB of model
  downloads, extra ~30 % wall clock per transcription). When on, the
  pipeline runs the extra step.

## sherpa-onnx CLI invocation

```
sherpa-onnx-offline-speaker-diarization \
  --segmentation.pyannote-model=<path>/model.onnx \
  --embedding.model=<path>/wespeaker_en_voxceleb_resnet34.onnx \
  --num-threads=<N> \
  [--clustering.num-clusters=<K> | --clustering.cluster-threshold=0.5] \
  <input.wav>
```

The CLI prints lines like:

```
0.000 -- 4.200 speaker_00
4.200 -- 7.800 speaker_01
...
```

to **stdout**. Parse this with a regex similar to whisper's progress
parser. `--clustering.cluster-threshold=0.5` lets the model auto-pick
the speaker count — that's what we want for unknown recordings;
expose `num-clusters` only as an advanced setting if at all.

## Plan for tomorrow's session — ordered

Each step is its own commit. Don't bundle.

### 1. Sherpa main-process module — `src/main/sherpa/`

Mirror `src/main/whisper/` structure:

- `binary.ts` — `findSherpaBinary()`. Copy
  `src/main/whisper/binary.ts` and swap `whisper` → `sherpa`,
  `whisper-cli` → `sherpa-onnx-offline-speaker-diarization`.
- `models.ts` — segmentation + embedding model paths,
  `isModelDownloaded()`, `modelPath()`. Either reuse the whisper
  models dir (`<userData>/models/`) with a `sherpa/` subdir, or split
  to `<userData>/sherpa-models/`. Recommendation: reuse and use a
  subdir, so the existing models manager knows about all model files.
- `catalog.ts` — two entries (segmentation, embedding) with URLs +
  size + sha256 + `language: 'multi'`.
- `download.ts` — segmentation comes as a `.tar.bz2`; need to extract
  after download. Whisper models are single `.bin` files so the existing
  download flow needs an "archive: tar.bz2" branch. Cleanest: add an
  `archive` field on the catalog entry; `download.ts` extracts when set.
- `diarize.ts` — spawn wrapper. Returns `Array<{start, end, speaker}>`.
  Stream stdout, parse the `START -- END speakerNN` lines, push to an
  array, resolve on close. Mirror whisper's `WhisperRunOptions` /
  `runWhisper` style.

### 2. Pipeline integration — `src/main/whisper/transcribe.ts`

After step 4 (whisper) completes, if `req.diarize === true`:

- Call `diarize({ wavPath, segmentationModel, embeddingModel, threads })`.
- Read the whisper JSON output (we already write it when `formats`
  includes `'json'` — for diarization we'll need to force-write the
  JSON internally even if the user didn't request it, then delete
  after if not requested).
- Merge: for each whisper segment, pick the speaker by max-overlap
  with sherpa segments. Threshold 50 %.
- Rewrite the user's requested output formats with speaker labels.
  Don't touch raw whisper outputs if no diarization happened.

### 3. Shared types — `src/shared/whisper.ts`

Add to `TranscribeRequest`:
- `diarize?: boolean`
- `segmentationModelName?: string`
- `embeddingModelName?: string`

Add to `TranscribeResult.outputs[fmt]` — currently a `string` (path).
Probably no schema change needed; the file at the path will contain
labels. But add a `numSpeakers?: number` to `TranscribeResult` for the
UI to show.

Add to `TranscribeProgress.phase`:
- `'diarizing'` (between `'transcribing'` and `'finalizing'`)

### 4. Renderer — model picker + toggle

- Extend the existing models manager UI (Transcription panel)
  with a "Speaker models" group. Two entries: segmentation +
  embedding. Same download / set-default / delete affordances.
- Add a "Detect speakers" toggle. Off by default.
- Show "Speaker 1" / "Speaker 2" / … as colored chips in the
  transcript viewer. Stable color per speaker index across the file.

### 5. CHANGELOG + version bump

`v0.3.0` is the natural bump (new feature, not a bugfix). Add to
`Unreleased` first; bump on release-prep commit.

### 6. Tests

`tests/sherpa/parse.test.ts` for the diarization line parser.
`tests/sherpa/merge.test.ts` for the segment-overlap merge.
Mocked, no real binary calls. The existing test suite uses Vitest;
mirror its patterns.

## Pitfalls / non-obvious

- **macOS Gatekeeper on the sherpa binary.** We don't sign or
  notarize. First launch of the diarization step in a release build
  will trip Gatekeeper. The whisper-cli binary has the same issue;
  apparently it works because the parent app is launched via the .dmg
  bypass and child-process spawns don't re-trigger the prompt. Verify
  this still holds for the sherpa binary on first packaged-build test.
  If not, document the override or `xattr -d com.apple.quarantine`
  steps.
- **Universal2 macOS binary.** Our `darwin-x64` mapping uses sherpa's
  `osx-universal2-static` tarball because they don't ship an x64-only
  build. The binary is fatter (~50 MB vs 24 MB) but works. Don't
  switch to `osx-arm64` for darwin-x64 — that breaks on Intel Macs.
- **Whisper temp WAV cleanup.** `transcribe.ts` deletes the temp dir
  in its `finally` block. The diarization step must run *before* that
  cleanup, since it consumes the same WAV. Just put the diarize call
  inside the same try block before the existing finalize.
- **Threading.** sherpa-onnx defaults to 4 threads; on M-series
  reusing whisper's `cpus()/2` math is fine. Don't run sherpa and
  whisper concurrently — they're both CPU-bound.
- **JSON whisper output is required for merge.** If the user requested
  only `.txt` or `.vtt`, we still need to ask whisper-cli for `-oj` so
  we have segment timestamps to merge against. Write to a temp path
  and delete after if not in the user's requested formats.
- **Single-speaker recordings.** When the embedding clustering returns
  one cluster (or sherpa emits only `speaker_00`), don't add
  `Speaker 1:` prefixes to output — that's noise.
- **i8mm parallel.** We had to disable `GGML_NATIVE` in
  `tools/fetch-whisper.mjs` to make the macOS build complete. The
  sherpa fetch script downloads prebuilt binaries (no compile step),
  so no equivalent fix needed there. Keep an eye on that if
  `SHERPA_VERSION` ever bumps.

## Useful pointers

- whisper main-process module to mirror: `src/main/whisper/`
- existing transcribe pipeline: `src/main/whisper/transcribe.ts`
- shared types: `src/shared/whisper.ts`
- electron-builder bundling rules: `electron-builder.yml`
- release flow (already wired for sherpa-onnx fetch + cache):
  `.github/workflows/release.yml`
- sherpa-onnx CLI options reference (run locally):
  `./resources/sherpa/<plat-arch>/sherpa-onnx-offline-speaker-diarization --help`
- model catalog reference (segmentation + speaker-recognition):
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models
