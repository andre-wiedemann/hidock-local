// Single-worker transcription queue. Both manual (per-row T button) and
// auto (after-download trigger) requests land in the same queue, run one
// at a time, and update the transcript panel + transfer panel as they go.
//
// Why a single worker:
//   - whisper-cli holds the model in RAM (~100MB-3GB depending on model).
//     Running two in parallel doubles RAM and contends for GPU/CPU; on
//     consumer hardware this thrashes hard.
//   - The user sees one transcription at a time progress in the panel,
//     so the in-app feedback maps to one process.
//
// The queue is renderer-side, not main-side. The main process happily
// runs whatever IPC requests come in; we serialize at the renderer layer.

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
import { TranscribeFormat, TranscribeResult } from '../../../shared/whisper.js';
import { whisperApi } from './api.js';
import { getPrefs } from './store.js';
import {
  setTranscriptResult,
  setTranscriptStatus,
  showExistingTranscript
} from './transcript-panel.js';

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
  return audioPath.replace(/\.(mp3|hda|wav|m4a|flac|ogg)$/i, '');
}

/**
 * Returns the absolute path of an existing transcript output for `file`,
 * if one is on disk next to the audio. Probes .txt → .vtt → .json in
 * that order, returning the first hit.
 */
async function findExistingTranscript(file: RecordingFile): Promise<string | null> {
  if (!state.dirPath) return null;
  const saveName = applyExtensionPreference(file.name, getMp3Pref());
  const audioPath = joinPath(state.dirPath, saveName);
  const basePath = basePathFor(audioPath);
  for (const ext of ['.txt', '.vtt', '.json'] as const) {
    const path = `${basePath}${ext}`;
    if (await window.hidock.fs.pathExists(path)) return path;
  }
  return null;
}

function ensureProgressSubscription(requestId: string): void {
  progressUnsub?.();
  progressUnsub = whisperApi().onProgress((p) => {
    if (p.requestId !== requestId) return;
    setTranscribeProgress(p.phase, p.percent);
  });
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface TranscribeOptions {
  /** When true, log + transfer-panel updates are quiet (auto-transcribe path). */
  quiet?: boolean;
}

// ─── Queue ───────────────────────────────────────────────────────────────

interface QueueEntry {
  file: RecordingFile;
  opts: TranscribeOptions;
}

const queue: QueueEntry[] = [];
let workerRunning = false;

function pendingCount(): number {
  return queue.length + (workerRunning ? 1 : 0);
}

function describeQueue(): string {
  const total = pendingCount();
  if (total === 0) return '';
  if (total === 1) return '1 active';
  return `${queue.length} queued · 1 running`;
}

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        await runTranscribe(next.file, next.opts);
      } catch (err) {
        log(`Transcribe error: ${(err as Error).message}`, 'error');
      }
    }
  } finally {
    workerRunning = false;
    setTranscriptStatus('');
  }
}

/**
 * Public entry point. Enqueues a transcription request — runs immediately
 * if the queue is empty, otherwise waits its turn behind any in-flight or
 * already-queued request.
 */
export function transcribeFile(file: RecordingFile, opts: TranscribeOptions = {}): void {
  queue.push({ file, opts });
  if (workerRunning) {
    log(`Queued for transcription: ${file.name} (${describeQueue()})`, 'info');
    setTranscriptStatus(describeQueue());
  }
  runWorker();
}

/**
 * Click-T behavior: if a transcript already exists for this recording,
 * surface it in the panel and stop. Otherwise enqueue a fresh transcribe
 * request. The panel's Re-transcribe button is the explicit way to
 * rerun (after a model switch or a bad result).
 */
export async function viewOrTranscribe(file: RecordingFile): Promise<void> {
  const existing = await findExistingTranscript(file);
  if (existing) {
    log(`Showing existing transcript for ${file.name}`, 'info');
    await showExistingTranscript(file, existing);
    return;
  }
  transcribeFile(file);
}

/**
 * Enqueue an auto-transcribe (post-download). Quiet by default — transfer
 * panel stays focused on downloads, only the debug log + transcript panel
 * reflect the work.
 */
export function maybeAutoTranscribe(
  file: RecordingFile,
  opts: TranscribeOptions = { quiet: true }
): void {
  const prefs = getPrefs();
  if (!prefs.autoTranscribe) return;
  if (!prefs.defaultModel) return;
  if (!state.dirPath) return;
  transcribeFile(file, opts);
}

export function isTranscribing(): boolean {
  return workerRunning || queue.length > 0;
}

/** Cancel the in-flight transcription; queued items past it remain queued. */
export async function cancelTranscribe(): Promise<void> {
  if (!activeRequestId) return;
  await whisperApi().cancel(activeRequestId);
}

// ─── Inner: actually run one transcription ──────────────────────────────

async function runTranscribe(file: RecordingFile, opts: TranscribeOptions): Promise<void> {
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

  const requestId = generateRequestId();
  activeRequestId = requestId;

  try {
    // Step 1: ensure the file exists on disk. Auto-download if not.
    const saveName = applyExtensionPreference(file.name, getMp3Pref());
    let audioPath = await resolveAudioPath(file);
    if (!audioPath) {
      if (!state.device) {
        log(`${saveName} isn't downloaded yet and the device isn't connected.`, 'error');
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

    // Step 2: transcribe with progress wiring.
    if (!opts.quiet) {
      showTransferPanel();
      setSpeedDisplay(0);
      setEtaDisplay(NaN);
      updateProgress(0, 1, `Transcribing: ${file.name}`);
    }
    setTranscribeProgress('preparing', 0);
    setTranscriptStatus(describeQueue());
    ensureProgressSubscription(requestId);

    if (!opts.quiet) log(`Transcribing ${file.name}…`, 'info');

    let result: TranscribeResult;
    try {
      result = await whisperApi().transcribe({
        requestId,
        audioPath,
        modelName: prefs.defaultModel,
        formats,
        basePath: basePathFor(audioPath),
        language: prefs.language || undefined
      });
    } catch (err) {
      const e = err as { code?: string; message: string };
      log(`✗ Transcribe failed: ${e.message ?? 'unknown error'}`, 'error');
      return;
    }

    const wrote = Object.keys(result.outputs).join(', ') || 'no files';
    log(
      `✓ Transcribed ${file.name} in ${result.durationSec.toFixed(1)}s · wrote ${wrote}`,
      'success'
    );
    setTranscribeProgress('finalizing', 100);

    // Step 3: load the transcript into the in-app panel.
    await setTranscriptResult(file, result);
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
