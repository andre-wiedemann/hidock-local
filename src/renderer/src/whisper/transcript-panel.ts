// In-app viewer for transcriptions. Two modes:
//   - "fresh"     — populated by setTranscriptResult after a transcribe
//                   completes. Shows lang + duration metadata.
//   - "existing"  — populated by showExistingTranscript when the user
//                   clicks T on a row that already has a transcript on
//                   disk. Shows ".txt · loaded from disk".
// Either way, a "Re-transcribe" button stays visible whenever a file is
// loaded, so the user can rerun (after switching models, or to retry a
// bad result).

import type { TranscribeResult } from '../../../shared/whisper.js';
import type { RecordingFile } from '../state.js';

interface PanelState {
  panel: HTMLElement;
  meta: HTMLElement;
  filenameEl: HTMLElement;
  detailEl: HTMLElement;
  textEl: HTMLElement;
  reBtn: HTMLButtonElement;
}

function getEls(): PanelState | null {
  const panel = document.getElementById('transcriptPanel');
  const meta = document.getElementById('transcriptPanelMeta');
  const filenameEl = document.getElementById('transcriptFilename');
  const detailEl = document.getElementById('transcriptDetail');
  const textEl = document.getElementById('transcriptText');
  const reBtn = document.getElementById('reTranscribeBtn') as HTMLButtonElement | null;
  if (!panel || !meta || !filenameEl || !detailEl || !textEl || !reBtn) return null;
  return { panel, meta, filenameEl, detailEl, textEl, reBtn };
}

let currentFile: RecordingFile | null = null;

/** Returns the recording currently shown in the panel, or null. */
export function getCurrentTranscriptFile(): RecordingFile | null {
  return currentFile;
}

export function showTranscriptPanel(): void {
  const els = getEls();
  if (!els) return;
  els.panel.style.display = 'block';
  // Auto-expand if the user previously collapsed it — they just kicked
  // off a transcription and want to see the result.
  els.panel.classList.remove('collapsed');
}

/**
 * Replace the panel's body with the given transcript. Reads the .txt
 * output via IPC; falls back to a placeholder if the file is empty or
 * unreadable. Auto-scrolls to top so the panel always shows the start
 * of the new transcript.
 */
export async function setTranscriptResult(
  file: RecordingFile,
  result: TranscribeResult
): Promise<void> {
  const els = getEls();
  if (!els) return;

  const formatExt = result.outputs.txt
    ? '.txt'
    : result.outputs.vtt
      ? '.vtt'
      : result.outputs.json
        ? '.json'
        : null;
  const sourcePath =
    result.outputs.txt ?? result.outputs.vtt ?? result.outputs.json ?? null;

  currentFile = file;
  els.filenameEl.textContent = file.name;
  els.detailEl.textContent = formatDetail(result, formatExt);
  els.textEl.textContent = '(loading…)';
  els.reBtn.style.display = 'inline-block';
  showTranscriptPanel();

  if (!sourcePath) {
    els.textEl.textContent = '(no output files were produced)';
    return;
  }

  try {
    const text = await window.hidock.fs.readTextFile(sourcePath);
    els.textEl.textContent = text.trim().length === 0
      ? '(empty transcription — try a larger model or check the audio level)'
      : text;
    els.textEl.scrollTop = 0;
  } catch (err) {
    els.textEl.textContent = `Failed to read ${sourcePath}: ${(err as Error).message}`;
  }
}

/**
 * Show a transcript that's already on disk (no transcribe ran).
 * Triggered by the per-row T button when a `<basename>.txt` (or .vtt /
 * .json fallback) is found next to the audio file.
 */
export async function showExistingTranscript(
  file: RecordingFile,
  path: string
): Promise<void> {
  const els = getEls();
  if (!els) return;
  const ext = path.match(/\.(\w+)$/)?.[1] ?? '';
  currentFile = file;
  els.filenameEl.textContent = file.name;
  els.detailEl.textContent = `loaded from disk · .${ext}`;
  els.textEl.textContent = '(loading…)';
  els.reBtn.style.display = 'inline-block';
  showTranscriptPanel();
  try {
    const text = await window.hidock.fs.readTextFile(path);
    els.textEl.textContent = text.trim().length === 0
      ? '(empty file — re-transcribe to try again)'
      : text;
    els.textEl.scrollTop = 0;
  } catch (err) {
    els.textEl.textContent = `Failed to read ${path}: ${(err as Error).message}`;
  }
}

/** Update just the meta-line at the top while a transcribe is queued/running. */
export function setTranscriptStatus(message: string): void {
  const els = getEls();
  if (!els) return;
  els.meta.textContent = message;
}

function formatDetail(result: TranscribeResult, format: string | null): string {
  const parts: string[] = [];
  if (format) parts.push(format);
  if (result.detectedLanguage) parts.push(`lang ${result.detectedLanguage}`);
  parts.push(`${result.durationSec.toFixed(1)}s`);
  return parts.join(' · ');
}
