// File-list panel: renders rows grouped by day, handles selection (including
// shift-range), live filtering, and the per-row play/retry buttons.

import { state, RecordingFile } from '../state.js';
import { dayKey, dayLabel, applyExtensionPreference } from '../util/filename.js';
import { formatBytes } from '../util/format.js';
import { previewFile, togglePreviewPlayback } from './preview.js';
import { getPrefs } from '../whisper/store.js';
import { viewOrTranscribe } from '../whisper/transcribe-flow.js';

type FileHandler = (file: RecordingFile) => void | Promise<void>;

let retryHandler: FileHandler = () => {};
let downloadHandler: FileHandler = () => {};

export function setRetryHandler(handler: FileHandler): void {
  retryHandler = handler;
}

export function setDownloadHandler(handler: FileHandler): void {
  downloadHandler = handler;
}

function getSaveFilename(name: string): string {
  const useMp3 = (document.getElementById('useMp3Ext') as HTMLInputElement | null)?.checked ?? true;
  return applyExtensionPreference(name, useMp3);
}

function isSaved(savedName: string): boolean {
  return !!state.savedFiles[savedName];
}

function isSkipSavedActive(): boolean {
  return (document.getElementById('skipSavedToggle') as HTMLInputElement | null)?.checked ?? false;
}

export function renderFileList(metaSuffix?: string): void {
  const dayCounts = new Map<string, number>();
  for (const f of state.files) {
    const k = dayKey(f.name);
    dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1);
  }

  const listDiv = document.getElementById('fileList')!;
  listDiv.innerHTML = '';

  let lastDay: string | null = null;
  state.files.forEach((file, index) => {
    const k = dayKey(file.name);
    if (k !== lastDay) {
      lastDay = k;
      const header = document.createElement('div');
      header.className = 'day-header';
      header.dataset['dayKey'] = k || 'unknown';
      const count = dayCounts.get(k) ?? 0;
      header.innerHTML = `<span>${dayLabel(k)}</span><span class="count">${count} ${count === 1 ? 'recording' : 'recordings'}</span>`;
      listDiv.appendChild(header);
    }

    const item = document.createElement('div');
    const saveName = getSaveFilename(file.name);
    const saved = isSaved(saveName);
    item.className = `file-item ${file.status}${saved ? ' is-saved' : ''}`;
    item.dataset['dayKey'] = k || 'unknown';
    item.dataset['fileIndex'] = String(index);

    // Badge is always rendered; visibility hinges on the row's .is-saved
    // class so we can flip it in place after a disk-scan refresh without
    // re-rendering the whole list (and losing scroll position).
    const sizeText = file.size > 0 ? formatBytes(file.size) : '—';
    const initiallyChecked = saved && isSkipSavedActive() ? '' : 'checked';

    const hasModel = !!getPrefs().defaultModel;
    // T is enabled whenever a model + folder are set; if the file isn't
    // on disk yet, the transcribe flow downloads it first automatically.
    const canTranscribe = hasModel;
    const transcribeTitle = !hasModel
      ? 'Pick a default model in the Transcription panel'
      : saved
        ? 'Transcribe with whisper.cpp'
        : 'Transcribe (downloads the file first)';

    item.innerHTML = `
      <label style="display: flex; align-items: center; flex: 1; min-width: 0; cursor: pointer; gap: 14px; padding: 11px 0 11px 24px;">
        <input type="checkbox" ${initiallyChecked}>
        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><span class="saved-badge">✓ Saved</span>${file.name}</span>
        <span class="file-size">${sizeText}</span>
      </label>
      <button class="download-btn" type="button" title="Download to chosen folder">↓</button>
      <button class="retry-btn" type="button" title="Retry this file">↻</button>
      <button class="transcribe-btn" type="button" title="${transcribeTitle}" ${canTranscribe ? '' : 'disabled'}>T</button>
      <button class="play-btn" type="button" title="Preview">▶</button>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    state.files[index].selected = checkbox.checked;

    checkbox.addEventListener('click', (e: MouseEvent) => {
      if (
        e.shiftKey &&
        state.lastClickedFileIndex !== null &&
        state.lastClickedFileIndex !== index
      ) {
        const target = checkbox.checked;
        const start = Math.min(state.lastClickedFileIndex, index);
        const end = Math.max(state.lastClickedFileIndex, index);
        document.querySelectorAll('#fileList .file-item').forEach((row) => {
          const ri = parseInt((row as HTMLElement).dataset['fileIndex'] ?? '', 10);
          if (
            Number.isFinite(ri) &&
            ri >= start &&
            ri <= end &&
            !row.classList.contains('hidden')
          ) {
            const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (cb) {
              cb.checked = target;
              if (state.files[ri]) state.files[ri].selected = target;
            }
          }
        });
        updateSelectionCount();
      }
      state.lastClickedFileIndex = index;
    });

    checkbox.addEventListener('change', () => {
      const f = state.files[index];
      if (!f) return;
      f.selected = checkbox.checked;
      updateSelectionCount();
    });

    // All per-row buttons guard against state.files going empty mid-render
    // (List Files clears + repopulates). Without the guard we hit
    // "Cannot read properties of undefined" if the user clicks a row
    // during the reload window.
    const playBtn = item.querySelector('.play-btn') as HTMLButtonElement;
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = state.files[index];
      if (!f) return;
      // If this row is the currently-loaded preview, toggle play/pause
      // in the mini-player instead of triggering a fresh preview pull.
      if (state.previewingFileIndex === index) {
        togglePreviewPlayback();
      } else {
        previewFile(f);
      }
    });

    const retryBtn = item.querySelector('.retry-btn') as HTMLButtonElement;
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = state.files[index];
      if (f) retryHandler(f);
    });

    const transcribeBtn = item.querySelector('.transcribe-btn') as HTMLButtonElement;
    transcribeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = state.files[index];
      if (f) viewOrTranscribe(f);
    });

    const downloadBtn = item.querySelector('.download-btn') as HTMLButtonElement;
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = state.files[index];
      if (f) downloadHandler(f);
    });

    listDiv.appendChild(item);
  });

  document.getElementById('fileList')!.style.display = 'block';
  document.getElementById('fileSelectionControls')!.style.display = 'flex';
  document.getElementById('zipInfo')!.style.display = 'block';

  const meta = document.getElementById('filesPanelMeta');
  if (meta) {
    meta.textContent = `${state.files.length} TOTAL · LATEST FIRST${metaSuffix ? ' · ' + metaSuffix : ''}`;
  }

  applyFilter();
  updateSelectionCount();
}

export function updateSelectionCount(): void {
  const sel = state.files.filter((f) => f.selected);
  const totalBytes = sel.reduce((s, f) => s + (f.size || 0), 0);
  const visible = visibleFileCount();
  const countEl = document.getElementById('selectionCount');
  if (!countEl) return;
  const sizeStr = totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : '';
  if (visible !== state.files.length) {
    countEl.textContent = `${sel.length} / ${state.files.length} selected${sizeStr} · ${visible} shown`;
  } else {
    countEl.textContent = `${sel.length} / ${state.files.length} selected${sizeStr}`;
  }
}

export function visibleFileCount(): number {
  const rows = document.querySelectorAll('#fileList .file-item');
  let n = 0;
  rows.forEach((r) => {
    if (!r.classList.contains('hidden')) n++;
  });
  return n;
}

export function applyFilter(): void {
  const term = (
    (document.getElementById('searchInput') as HTMLInputElement | null)?.value ?? ''
  )
    .trim()
    .toLowerCase();

  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  const visibleByDay = new Map<string, number>();
  rows.forEach((row) => {
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const file = state.files[idx];
    if (!file) return;
    const match = !term || file.name.toLowerCase().includes(term);
    row.classList.toggle('hidden', !match);
    const k = row.dataset['dayKey'] ?? 'unknown';
    if (match) visibleByDay.set(k, (visibleByDay.get(k) ?? 0) + 1);
  });

  document.querySelectorAll<HTMLElement>('#fileList .day-header').forEach((h) => {
    const k = h.dataset['dayKey'] ?? 'unknown';
    h.classList.toggle('hidden', !visibleByDay.get(k));
  });

  updateSelectionCount();
}

export function setVisibleSelected(selected: boolean): void {
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  rows.forEach((row) => {
    if (row.classList.contains('hidden')) return;
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (cb) {
      cb.checked = selected;
      if (state.files[idx]) state.files[idx].selected = selected;
    }
  });
  updateSelectionCount();
}

export function applySkipSavedToggle(skip: boolean): void {
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const file = state.files[idx];
    if (!file) return;
    const saved = isSaved(getSaveFilename(file.name));
    if (saved) {
      const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (cb) {
        cb.checked = !skip;
        file.selected = !skip;
      }
    }
  });
  updateSelectionCount();
}

/** Update a single row's status + size + class without re-rendering the whole list. */
export function updateRow(file: RecordingFile, status: RecordingFile['status']): void {
  const idx = state.files.indexOf(file);
  if (idx < 0) return;
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  const row = rows[idx];
  if (!row) return;

  const saveName = getSaveFilename(file.name);
  const saved = isSaved(saveName);
  row.className = `file-item ${status}${saved ? ' is-saved' : ''}`;

  const sizeEl = row.querySelector('.file-size') as HTMLElement | null;
  if (sizeEl && file.size > 0) {
    sizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
  }

  refreshTranscribeButton(row, saved);
}

function refreshTranscribeButton(row: HTMLElement, saved: boolean): void {
  const btn = row.querySelector('.transcribe-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const hasModel = !!getPrefs().defaultModel;
  btn.disabled = !hasModel;
  btn.title = !hasModel
    ? 'Pick a default model in the Transcription panel'
    : saved
      ? 'Transcribe with whisper.cpp'
      : 'Transcribe (downloads the file first)';
}

/**
 * Re-evaluate every row's transcribe button — used after the default
 * model changes (download completes / user switches default / model
 * deleted). Cheaper than re-rendering the list.
 */
export function refreshAllTranscribeButtons(): void {
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const file = state.files[idx];
    if (!file) return;
    const saved = isSaved(getSaveFilename(file.name));
    refreshTranscribeButton(row, saved);
  });
}

/**
 * Sync each row's preview indicator with `state.previewingFileIndex` and
 * `state.previewIsPlaying`. Called from app.ts via the
 * onPreviewStateChange subscription, so the row reflects play / pause
 * changes regardless of whether they originated from the per-row button
 * or the mini-player's own controls.
 */
export function refreshAllPlayingIndicators(): void {
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const isCurrent = idx === state.previewingFileIndex;
    const isPlaying = isCurrent && state.previewIsPlaying;
    row.classList.toggle('is-playing', isPlaying);
    row.classList.toggle('is-current-preview', isCurrent && !isPlaying);
    const btn = row.querySelector('.play-btn') as HTMLButtonElement | null;
    if (btn && !btn.classList.contains('loading')) {
      btn.textContent = isPlaying ? '⏸' : '▶';
    }
  });
}

/**
 * Re-evaluate every row's saved state in-place. Called after a disk-scan
 * refresh — toggles the row's .is-saved class (which controls badge
 * visibility via CSS) and refreshes the transcribe button tooltip.
 */
export function refreshAllSavedStates(): void {
  const rows = document.querySelectorAll<HTMLElement>('#fileList .file-item');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset['fileIndex'] ?? '', 10);
    const file = state.files[idx];
    if (!file) return;
    const saved = isSaved(getSaveFilename(file.name));
    row.classList.toggle('is-saved', saved);
    refreshTranscribeButton(row, saved);
  });
}
