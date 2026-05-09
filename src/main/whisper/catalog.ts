// Static catalog of whisper.cpp ggml models we surface in the UI.
//
// All sizes are approximate (taken from Hugging Face headers); the download
// manager uses the actual Content-Length header at fetch time. Sizes here
// drive the "before download" UI only.
//
// Reference: https://huggingface.co/ggerganov/whisper.cpp

export interface ModelCatalogEntry {
  /** Canonical name passed to whisper-cli (-m models/ggml-<name>.bin). */
  name: string;
  /** UI label. */
  displayName: string;
  /** Approximate size in bytes for pre-download UI. */
  sizeBytes: number;
  /** Recommended use-case tagline. */
  recommendation: string;
}

const MIB = 1024 * 1024;

export const MODEL_CATALOG: ReadonlyArray<ModelCatalogEntry> = [
  {
    name: 'tiny.en',
    displayName: 'Tiny · English',
    sizeBytes: 75 * MIB,
    recommendation: 'Quick checks. Low accuracy on accented speech.'
  },
  {
    name: 'tiny',
    displayName: 'Tiny · Multilingual',
    sizeBytes: 75 * MIB,
    recommendation: 'Quick checks. Multilingual but small.'
  },
  {
    name: 'base.en',
    displayName: 'Base · English',
    sizeBytes: 142 * MIB,
    recommendation: 'Balanced default for English voice memos.'
  },
  {
    name: 'base',
    displayName: 'Base · Multilingual',
    sizeBytes: 142 * MIB,
    recommendation: 'Balanced default if you record in multiple languages.'
  },
  {
    name: 'small.en',
    displayName: 'Small · English',
    sizeBytes: 466 * MIB,
    recommendation: 'Better accuracy on noisy or fast speech.'
  },
  {
    name: 'small',
    displayName: 'Small · Multilingual',
    sizeBytes: 466 * MIB,
    recommendation: 'Better accuracy multilingual.'
  },
  {
    name: 'large-v3-turbo-q5_0',
    displayName: 'Large v3 turbo · Q5_0 quantized',
    sizeBytes: 574 * MIB,
    recommendation: 'Recommended quality/speed trade-off on Apple Silicon.'
  },
  {
    name: 'medium.en',
    displayName: 'Medium · English',
    sizeBytes: 1500 * MIB,
    recommendation: 'High quality. Slow on CPU; reasonable on Metal/CUDA.'
  },
  {
    name: 'large-v3-turbo',
    displayName: 'Large v3 turbo',
    sizeBytes: 1500 * MIB,
    recommendation: 'Faster than large-v3 with similar accuracy.'
  },
  {
    name: 'large-v3',
    displayName: 'Large v3',
    sizeBytes: 2900 * MIB,
    recommendation: 'Best multilingual accuracy. Slow without GPU.'
  }
];

/** Hugging Face URL for a given model name. */
export function modelUrl(name: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
}

export function findEntry(name: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.name === name);
}
