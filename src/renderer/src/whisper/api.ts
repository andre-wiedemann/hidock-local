// Typed accessor for the preload-exposed Whisper API.
//
// The contextBridge in src/preload/index.ts exposes the same shape as
// `WhisperApi` from src/shared/whisper.ts — this module just declares the
// global so the rest of the renderer can use it with autocomplete.

import type { WhisperApi } from '../../../shared/whisper.js';

interface HidockGlobal {
  platform: string;
  version: string;
  whisper: WhisperApi;
}

declare global {
  interface Window {
    hidock: HidockGlobal;
  }
}

export function whisperApi(): WhisperApi {
  return window.hidock.whisper;
}
