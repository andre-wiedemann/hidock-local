// "Saved Files" panel — appended to as each file finishes saving. Two modes:
//
//   - dirHandle path:   each row shows ✓ filename + size, no link
//   - browser-download: row shows clickable ↓ link + Save As button
//
// The dirHandle path is exercised on every Electron run because the renderer
// always has File System Access available. The browser-download fallback is
// kept for the occasional run where the user clears their folder choice.

import { state } from '../state.js';
import { saveBlobToFolder } from './save-target.js';
import { log } from './log.js';

export function clearSavedFilesPanel(): void {
  const items = document.getElementById('zipItems');
  if (items) items.innerHTML = '';
  const list = document.getElementById('zipList');
  if (list) list.style.display = 'none';
}

export async function presentSaveableBlob(
  blob: Blob,
  filename: string,
  autoSave: boolean,
  label: string,
  fileCount: number | null = null
): Promise<void> {
  const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
  const isZip = filename.toLowerCase().endsWith('.zip');

  if (state.dirPath) {
    try {
      await saveBlobToFolder(blob, filename);
      markSaved(filename, blob.size);
      appendSavedRow(filename, sizeMB, fileCount);
      log(`✅ Wrote ${filename} (${sizeMB} MB) to ${state.dirPath}`, 'success');
      return;
    } catch (err) {
      log(
        `Direct-to-disk write failed for ${filename}: ${(err as Error).message} — falling back to browser download`,
        'warning'
      );
      // Don't auto-clear dirPath — the user might fix the folder permission
      // issue and retry. Surfacing the error in the log is enough.
    }
  }

  appendDownloadLinkRow(blob, filename, sizeMB, fileCount, label, autoSave, isZip);
}

function appendSavedRow(filename: string, sizeMB: string, fileCount: number | null): void {
  const item = document.createElement('div');
  item.className = 'zip-item';

  const left = document.createElement('div');
  left.style.flex = '1';
  left.style.minWidth = '0';
  left.style.overflow = 'hidden';
  left.style.textOverflow = 'ellipsis';
  left.style.whiteSpace = 'nowrap';
  left.innerHTML = `<span style="color: var(--success);">✓</span>  ${filename}`;

  const meta = document.createElement('span');
  meta.textContent = fileCount != null ? `${sizeMB} MB · ${fileCount} files` : `${sizeMB} MB`;

  item.appendChild(left);
  item.appendChild(meta);
  document.getElementById('zipItems')!.appendChild(item);
  document.getElementById('zipList')!.style.display = 'block';
}

function appendDownloadLinkRow(
  blob: Blob,
  filename: string,
  sizeMB: string,
  fileCount: number | null,
  label: string,
  autoSave: boolean,
  isZip: boolean
): void {
  const url = URL.createObjectURL(blob);
  const item = document.createElement('div');
  item.className = 'zip-item';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.gap = '12px';
  left.style.alignItems = 'center';
  left.style.minWidth = '0';
  left.style.flex = '1';

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.textContent = `↓  ${filename}`;
  link.style.overflow = 'hidden';
  link.style.textOverflow = 'ellipsis';
  link.style.whiteSpace = 'nowrap';
  left.appendChild(link);

  if ('showSaveFilePicker' in window) {
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save As…';
    saveBtn.onclick = async () => {
      try {
        const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : 'bin';
        const accept: Record<string, string[]> = isZip
          ? { 'application/zip': ['.zip'] }
          : { 'application/octet-stream': [`.${ext}`] };
        const handle = await (window as unknown as {
          showSaveFilePicker(opts: {
            suggestedName: string;
            types: Array<{ description: string; accept: Record<string, string[]> }>;
          }): Promise<FileSystemFileHandle>;
        }).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: label, accept }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markSaved(filename, blob.size);
        log(`✅ Written via Save As: ${filename}`, 'success');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          log(`Save As failed: ${(err as Error).message}`, 'error');
        }
      }
    };
    left.appendChild(saveBtn);
  }

  const meta = document.createElement('span');
  meta.textContent = fileCount != null ? `${sizeMB} MB · ${fileCount} files` : `${sizeMB} MB`;

  item.appendChild(left);
  item.appendChild(meta);
  document.getElementById('zipItems')!.appendChild(item);
  document.getElementById('zipList')!.style.display = 'block';

  if (autoSave) {
    link.click();
    log(
      `✅ ${label} saved: ${filename} (${sizeMB} MB) — if nothing downloaded, click "Save As…" above`,
      'success'
    );
  } else {
    log(
      `${label} ready: ${filename} (${sizeMB} MB) — click the link or "Save As…" above`,
      'info'
    );
  }
}

function markSaved(filename: string, size: number): void {
  state.savedFiles[filename] = { size, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem('hidock:downloaded', JSON.stringify(state.savedFiles));
  } catch {
    // Quota issues — non-fatal.
  }
}
