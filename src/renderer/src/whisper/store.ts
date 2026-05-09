// Renderer-side state for whisper.cpp models and transcription preferences.
//
// Persisted to localStorage under `hidock:whisper` so the user's default
// model + auto-transcribe + output-format choices survive reloads.

import { ModelInfo } from '../../../shared/whisper.js';
import { whisperApi } from './api.js';

const STORAGE_KEY = 'hidock:whisper';

export interface WhisperPrefs {
  /** Name of the default model used for transcribe + auto-transcribe. */
  defaultModel: string | null;
  /** Whether to auto-transcribe each file as it finishes downloading. */
  autoTranscribe: boolean;
  /** Output formats to write next to the MP3. */
  formats: { txt: boolean; vtt: boolean; json: boolean };
  /** Optional language override. Empty string = auto-detect. */
  language: string;
}

const DEFAULTS: WhisperPrefs = {
  defaultModel: null,
  autoTranscribe: false,
  formats: { txt: true, vtt: true, json: false },
  language: ''
};

let prefs: WhisperPrefs = loadPrefs();
let models: ModelInfo[] = [];

/** In-flight downloads keyed by model name. */
const downloading = new Map<string, { percent: number; bytesDownloaded: number; bytesTotal: number }>();

type Listener = () => void;
const listeners = new Set<Listener>();

function loadPrefs(): WhisperPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, formats: { ...DEFAULTS.formats } };
    const stored = JSON.parse(raw) as Partial<WhisperPrefs>;
    return {
      ...DEFAULTS,
      ...stored,
      formats: { ...DEFAULTS.formats, ...(stored.formats ?? {}) }
    };
  } catch {
    return { ...DEFAULTS, formats: { ...DEFAULTS.formats } };
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or storage disabled — non-fatal.
  }
}

function notify(): void {
  for (const cb of listeners) cb();
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPrefs(): WhisperPrefs {
  return prefs;
}

export function getModels(): ModelInfo[] {
  return models;
}

export function getDownloadProgress(name: string):
  | { percent: number; bytesDownloaded: number; bytesTotal: number }
  | undefined {
  return downloading.get(name);
}

export function setDefaultModel(name: string): void {
  prefs = { ...prefs, defaultModel: name };
  savePrefs();
  notify();
}

export function setAutoTranscribe(on: boolean): void {
  prefs = { ...prefs, autoTranscribe: on };
  savePrefs();
  notify();
}

export function setFormat(format: 'txt' | 'vtt' | 'json', on: boolean): void {
  prefs = { ...prefs, formats: { ...prefs.formats, [format]: on } };
  savePrefs();
  notify();
}

export function setLanguage(lang: string): void {
  prefs = { ...prefs, language: lang };
  savePrefs();
  notify();
}

/** Refresh model state from the main process. */
export async function refreshModels(): Promise<void> {
  models = await whisperApi().listModels();
  // If the persisted default no longer exists on disk, clear it.
  if (prefs.defaultModel && !models.find((m) => m.name === prefs.defaultModel && m.downloaded)) {
    prefs = { ...prefs, defaultModel: null };
    savePrefs();
  }
  // If no default but exactly one model is downloaded, auto-select it —
  // the common case after the user's first download.
  if (!prefs.defaultModel) {
    const downloaded = models.filter((m) => m.downloaded);
    if (downloaded.length === 1) {
      prefs = { ...prefs, defaultModel: downloaded[0].name };
      savePrefs();
    }
  }
  notify();
}

export async function downloadModelInteractive(name: string): Promise<void> {
  downloading.set(name, { percent: 0, bytesDownloaded: 0, bytesTotal: 0 });
  notify();
  try {
    await whisperApi().downloadModel(name);
    await refreshModels();
    if (!prefs.defaultModel) setDefaultModel(name);
  } finally {
    downloading.delete(name);
    notify();
  }
}

export async function cancelDownload(name: string): Promise<void> {
  await whisperApi().cancelDownload(name);
  downloading.delete(name);
  notify();
}

export async function deleteModelInteractive(name: string): Promise<void> {
  await whisperApi().deleteModel(name);
  await refreshModels();
  if (prefs.defaultModel === name) {
    prefs = { ...prefs, defaultModel: null };
    savePrefs();
    notify();
  }
}

/** Wire main-process download-progress events into the local store. */
export function wireDownloadProgressBridge(): () => void {
  return whisperApi().onDownloadProgress((p) => {
    downloading.set(p.name, {
      percent: p.percent,
      bytesDownloaded: p.bytesDownloaded,
      bytesTotal: p.bytesTotal
    });
    notify();
  });
}
