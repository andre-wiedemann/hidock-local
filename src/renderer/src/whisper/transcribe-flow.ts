// One-shot transcribe orchestration: takes a recording file the user has
// already downloaded, resolves its path on disk, runs whisper.cpp via IPC,
// and emits status into the transfer panel + debug log.
//
// Entry points:
//   transcribeFile(file)         — user-triggered (per-row T button)
//   maybeAutoTranscribe(file)    — fire-and-forget after a download finishes

import { state, RecordingFile } from '../state.js';
import { applyExtensionPreference } from '../util/filename.js';
import { log } from '../ui/log.js';
import {
  setEtaDisplay,
  setSpeedDisplay,
  setTranscribeProgress,
  setTranscribeIdle,
  showTransferPanel,
  updateProgress
} from '../ui/transfer.js';
import { TranscribeFormat } from '../../../shared/whisper.js';
import { whisperApi } from './api.js';
import { getPrefs } from './store.js';

let activeRequestId: string | null = null;
let progressUnsub: (() => void) | null = null;

// Caller-injected single-file downloader. Wired in app.ts during init —
// breaks what would otherwise be a circular import between this module
// and downloader.ts (which already imports maybeAutoTranscribe from here).
type DownloadFn = (file: RecordingFile) => Promise<void>;
let downloadFn: DownloadFn = async () => {
  log('Internal error: download function not wired up.', 'error');
};

export function setDownloadFn(fn: DownloadFn): void {
  downloadFn = fn;
}

function getMp3Pref(): boolean {
  return (document.getElementById('useMp3Ext') as HTMLInputElement | null)?.checked ?? true;
}

function selectedFormats(): TranscribeFormat[] {
  const prefs = getPrefs();
  const out: TranscribeFormat[] = [];
  if (prefs.formats.txt) out.push('txt');
  if (prefs.formats.vtt) out.push('vtt');
  if (prefs.formats.json) out.push('json');
  return out;
}

/** Path separator that works for the platforms we ship to. */
function joinPath(dir: string, name: string): string {
  // The renderer doesn't have access to node:path, but '/' works on macOS
  // and Linux, and Node on Windows accepts mixed separators.
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * Resolve the absolute on-disk path for a recording's saved file.
 * Returns null if no folder is set or the file isn't on disk yet.
 */
async function resolveAudioPath(file: RecordingFile): Promise<string | null> {
  if (!state.dirPath) return null;
  const saveName = applyExtensionPreference(file.name, getMp3Pref());
  const path = joinPath(state.dirPath, saveName);
  const exists = await window.hidock.fs.pathExists(path);
  return exists ? path : null;
}

function basePathFor(audioPath: string): string {
  // Strip the audio extension; whisper-cli will append .txt / .vtt / .json.
  return audioPath.replace(/\.(mp3|hda|wav|m4a|flac|ogg)$/i, '');
}

function ensureProgressSubscription(requestId: string): void {
  // Subscribe lazily and only once per call. We keep the unsubscribe handle
  // so we can drop it when the transcribe promise settles.
  progressUnsub?.();
  progressUnsub = whisperApi().onProgress((p) => {
    if (p.requestId !== requestId) return;
    setTranscribeProgress(p.phase, p.percent);
  });
}

export interface TranscribeOptions {
  /** When true, log + UI updates are quiet (used by auto-transcribe path). */
  quiet?: boolean;
}

/**
 * Run whisper on a single recording file. Throws on user-facing problems
 * (no model, no dirHandle, file not downloaded) so callers can decide how
 * to surface them.
 */
export async function transcribeFile(
  file: RecordingFile,
  opts: TranscribeOptions = {}
): Promise<void> {
  const prefs = getPrefs();
  if (!prefs.defaultModel) {
    log('No default model — pick one in the Transcription panel.', 'warning');
    return;
  }
  if (!state.dirPath) {
    log('Choose a save folder before transcribing.', 'warning');
    return;
  }
  const formats = selectedFormats();
  if (formats.length === 0) {
    log('Enable at least one output format (.txt / .vtt / .json).', 'warning');
    return;
  }

  if (activeRequestId) {
    log('A transcription is already running. Wait for it to finish.', 'warning');
    return;
  }

  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeRequestId = requestId;

  try {
    // Step 1: ensure the file exists on disk. Auto-download if not.
    const saveName = applyExtensionPreference(file.name, getMp3Pref());
    let audioPath = await resolveAudioPath(file);
    if (!audioPath) {
      if (!state.device) {
        log(
          `${saveName} isn't downloaded yet and the device isn't connected.`,
          'error'
        );
        return;
      }
      log(`${saveName} not on disk — downloading first…`, 'info');
      await downloadFn(file);
      audioPath = await resolveAudioPath(file);
      if (!audioPath) {
        log(`Download didn't produce a file — can't transcribe.`, 'error');
        return;
      }
    }

    // Step 2: kick off transcription with progress wiring.
    if (!opts.quiet) {
      showTransferPanel();
      setSpeedDisplay(0);
      setEtaDisplay(NaN);
      updateProgress(0, 1, `Transcribing: ${file.name}`);
    }
    setTranscribeProgress('preparing', 0);
    ensureProgressSubscription(requestId);

    if (!opts.quiet) log(`Transcribing ${file.name}…`, 'info');

    const result = await whisperApi().transcribe({
      requestId,
      audioPath,
      modelName: prefs.defaultModel,
      formats,
      basePath: basePathFor(audioPath),
      language: prefs.language || undefined
    });
    const wrote = Object.keys(result.outputs).join(', ') || 'no files';
    log(
      `✓ Transcribed ${file.name} in ${result.durationSec.toFixed(1)}s · wrote ${wrote}`,
      'success'
    );
    setTranscribeProgress('finalizing', 100);
  } catch (err) {
    const e = err as { code?: string; message: string };
    log(`✗ Transcribe failed: ${e.message ?? 'unknown error'}`, 'error');
  } finally {
    progressUnsub?.();
    progressUnsub = null;
    activeRequestId = null;
    if (!opts.quiet) {
      setTranscribeIdle();
      updateProgress(1, 1, 'Done');
    }
  }
}

export function isTranscribing(): boolean {
  return activeRequestId !== null;
}

/** Cancel the in-flight transcription, if any. */
export async function cancelTranscribe(): Promise<void> {
  if (!activeRequestId) return;
  await whisperApi().cancel(activeRequestId);
}

// ─── Auto-transcribe queue ───────────────────────────────────────────
// Serializes auto-triggered transcribes so a multi-file batch download
// doesn't fan out into N parallel whisper processes (which would blow up
// RAM and GPU usage). Manual transcribes from the per-row button still go
// through transcribeFile() directly.

interface QueueEntry {
  file: RecordingFile;
  opts: TranscribeOptions;
}

const queue: QueueEntry[] = [];
let workerRunning = false;

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      await transcribeFile(next.file, next.opts).catch((err) => {
        log(`Auto-transcribe error: ${(err as Error).message}`, 'error');
      });
    }
  } finally {
    workerRunning = false;
  }
}

/**
 * Enqueue a fire-and-forget transcription for the download path. Quiet by
 * default — the transfer panel stays focused on downloads, and successful
 * transcriptions only show in the debug log.
 */
export function maybeAutoTranscribe(
  file: RecordingFile,
  opts: TranscribeOptions = { quiet: true }
): void {
  const prefs = getPrefs();
  if (!prefs.autoTranscribe) return;
  if (!prefs.defaultModel) return;
  if (!state.dirPath) return;
  queue.push({ file, opts });
  runWorker();
}
