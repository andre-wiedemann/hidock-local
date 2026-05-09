// User preferences persisted to localStorage.
// Settings auto-save when their input changes — no explicit Save button.

const SETTINGS_KEY = 'hidock:settings';

export interface AppSettings {
  useMp3Ext: boolean;
  skipSavedToggle: boolean;
  searchInput: string;
  maxZipSize: string;
  filesPerZip: string;
  autoSave: boolean;
}

const DEFAULTS: AppSettings = {
  useMp3Ext: true,
  skipSavedToggle: false,
  searchInput: '',
  maxZipSize: '100',
  filesPerZip: '20',
  autoSave: true
};

interface FieldSpec {
  id: keyof AppSettings;
  type: 'bool' | 'string';
}

const FIELDS: ReadonlyArray<FieldSpec> = [
  { id: 'useMp3Ext', type: 'bool' },
  { id: 'skipSavedToggle', type: 'bool' },
  { id: 'searchInput', type: 'string' },
  { id: 'maxZipSize', type: 'string' },
  { id: 'filesPerZip', type: 'string' },
  { id: 'autoSave', type: 'bool' }
];

export function loadSettings(): Partial<AppSettings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSettings(): void {
  const out: Record<string, unknown> = {};
  for (const { id, type } of FIELDS) {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | null;
    if (!el) continue;
    out[id] = type === 'bool' ? el.checked : el.value;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch {
    // Quota exceeded or storage disabled — non-fatal.
  }
}

/** Apply persisted values to the matching DOM inputs on page load. */
export function applySettings(): void {
  const stored = loadSettings();
  for (const { id, type } of FIELDS) {
    const el = document.getElementById(id) as
      | HTMLInputElement
      | null;
    if (!el) continue;
    const value = stored[id] ?? DEFAULTS[id];
    if (type === 'bool') el.checked = !!value;
    else el.value = String(value);
  }
}

/** Re-save settings every time any tracked input changes. */
export function wireSettingsAutosave(): void {
  for (const { id, type } of FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const event = type === 'bool' ? 'change' : 'input';
    el.addEventListener(event, saveSettings);
  }
}
