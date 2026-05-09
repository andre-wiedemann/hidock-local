// Renders the "Transcription" panel: model picker, default selector,
// auto-transcribe toggle, output-format toggles.
//
// Models are listed in catalog order with three states per row:
//   - Available (not yet downloaded) → Download button
//   - Downloading                    → progress bar + Cancel button
//   - Downloaded                     → Default radio + Delete button

import { formatBytes } from '../util/format.js';
import {
  cancelDownload,
  downloadModelInteractive,
  deleteModelInteractive,
  getDownloadProgress,
  getModels,
  getPrefs,
  refreshModels,
  setAutoTranscribe,
  setDefaultModel,
  setFormat,
  setLanguage,
  subscribe,
  wireDownloadProgressBridge
} from './store.js';
import { log } from '../ui/log.js';

let host: HTMLElement | null = null;
let unsubscribeStore: (() => void) | null = null;
let unsubscribeBridge: (() => void) | null = null;

export async function initWhisperPanel(): Promise<void> {
  host = document.getElementById('whisperPanelBody');
  if (!host) return;

  await refreshModels();
  unsubscribeBridge = wireDownloadProgressBridge();
  unsubscribeStore = subscribe(render);
  render();
}

export function destroyWhisperPanel(): void {
  unsubscribeStore?.();
  unsubscribeBridge?.();
}

function render(): void {
  if (!host) return;
  const models = getModels();
  const prefs = getPrefs();

  const defaultName = prefs.defaultModel;
  const defaultModel = models.find((m) => m.name === defaultName);

  host.innerHTML = `
    <div class="whisper-summary">
      <span class="label">Default model</span>
      <span class="path">${defaultModel
        ? `${escapeHtml(defaultModel.displayName)} · ${formatBytes(defaultModel.sizeBytes)}`
        : 'None — pick one below'}</span>
    </div>

    <div class="model-list" id="modelList"></div>

    <div class="whisper-options">
      <label class="toggle-inline">
        <input type="checkbox" id="autoTranscribeToggle" ${prefs.autoTranscribe ? 'checked' : ''} ${defaultModel ? '' : 'disabled'}>
        <span>Auto-transcribe after download</span>
      </label>
      <label class="toggle-inline"><input type="checkbox" id="fmtTxt" ${prefs.formats.txt ? 'checked' : ''}><span>.txt</span></label>
      <label class="toggle-inline"><input type="checkbox" id="fmtVtt" ${prefs.formats.vtt ? 'checked' : ''}><span>.vtt</span></label>
      <label class="toggle-inline"><input type="checkbox" id="fmtJson" ${prefs.formats.json ? 'checked' : ''}><span>.json</span></label>
      <label class="lang-input" title="Empty for auto-detect">
        <span>Lang</span>
        <input type="text" id="langInput" maxlength="5" placeholder="auto" value="${escapeHtml(prefs.language)}">
      </label>
    </div>
  `;

  const list = host.querySelector('#modelList') as HTMLElement;
  for (const m of models) {
    list.appendChild(modelRow(m));
  }

  wireOptionToggles();
}

function modelRow(m: ReturnType<typeof getModels>[number]): HTMLElement {
  const prefs = getPrefs();
  const dl = getDownloadProgress(m.name);
  const isDefault = prefs.defaultModel === m.name;

  const row = document.createElement('div');
  row.className = `model-row${m.downloaded ? ' is-downloaded' : ''}${isDefault ? ' is-default' : ''}`;

  const label = document.createElement('div');
  label.className = 'model-label';
  label.innerHTML = `
    <span class="name">${escapeHtml(m.displayName)}</span>
    <span class="size">${formatBytes(m.sizeBytes)}</span>
  `;

  const status = document.createElement('div');
  status.className = 'model-status';

  const actions = document.createElement('div');
  actions.className = 'model-actions';

  if (dl) {
    status.innerHTML = `<span class="dl-pct">↓ ${dl.percent}%</span>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      cancelDownload(m.name).catch((e) => log(`Cancel failed: ${e.message}`, 'error'));
    };
    actions.appendChild(cancelBtn);
  } else if (m.downloaded) {
    status.textContent = isDefault ? '✓ default' : 'downloaded';

    const setBtn = document.createElement('button');
    setBtn.textContent = isDefault ? 'Default' : 'Set Default';
    setBtn.disabled = isDefault;
    setBtn.onclick = () => setDefaultModel(m.name);
    actions.appendChild(setBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      if (!confirm(`Delete ${m.displayName}? It can be downloaded again.`)) return;
      try {
        await deleteModelInteractive(m.name);
        log(`Deleted model ${m.name}`, 'info');
      } catch (e) {
        log(`Delete failed: ${(e as Error).message}`, 'error');
      }
    };
    actions.appendChild(delBtn);
  } else {
    status.textContent = 'available';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'primary';
    dlBtn.textContent = 'Download';
    dlBtn.onclick = async () => {
      try {
        log(`Downloading ${m.name}…`, 'info');
        await downloadModelInteractive(m.name);
        log(`✓ Downloaded ${m.name}`, 'success');
      } catch (e) {
        log(`Download failed: ${(e as Error).message}`, 'error');
      }
    };
    actions.appendChild(dlBtn);
  }

  row.appendChild(label);
  row.appendChild(status);
  row.appendChild(actions);

  if (dl && dl.bytesTotal > 0) {
    const bar = document.createElement('div');
    bar.className = 'model-progress';
    bar.innerHTML = `<span class="bar-fill" style="width:${dl.percent}%"></span>`;
    row.appendChild(bar);
  }

  return row;
}

function wireOptionToggles(): void {
  if (!host) return;
  const auto = host.querySelector('#autoTranscribeToggle') as HTMLInputElement;
  auto?.addEventListener('change', () => setAutoTranscribe(auto.checked));

  (['txt', 'vtt', 'json'] as const).forEach((fmt) => {
    const el = host!.querySelector(`#fmt${fmt[0].toUpperCase()}${fmt.slice(1)}`) as HTMLInputElement;
    el?.addEventListener('change', () => setFormat(fmt, el.checked));
  });

  const lang = host.querySelector('#langInput') as HTMLInputElement;
  lang?.addEventListener('change', () => setLanguage(lang.value.trim()));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
