// Wire a `.panel.collapsible` element so clicking its header toggles a
// `collapsed` class. The collapsed state persists to localStorage under the
// caller-supplied key.
//
// HTML expectation:
//   <section class="panel collapsible" id="<panelId>">
//     <div class="panel-header" id="<headerId>">…<span class="collapse-chevron">▼</span></div>
//     <div class="panel-body">…</div>
//   </section>

export interface CollapsibleOptions {
  panelId: string;
  headerId: string;
  storageKey: string;
  /** Initial state when no value is in localStorage yet. Default: false (expanded). */
  defaultCollapsed?: boolean | (() => boolean);
}

export function wireCollapsible(opts: CollapsibleOptions): void {
  const panel = document.getElementById(opts.panelId);
  const header = document.getElementById(opts.headerId);
  if (!panel || !header) return;

  // Resolve initial state.
  const stored = readStored(opts.storageKey);
  const initial =
    stored !== null
      ? stored
      : typeof opts.defaultCollapsed === 'function'
        ? opts.defaultCollapsed()
        : opts.defaultCollapsed === true;
  panel.classList.toggle('collapsed', initial);

  const toggle = (): void => {
    const next = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', next);
    writeStored(opts.storageKey, next);
  };

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}

function readStored(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeStored(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage disabled — non-fatal.
  }
}
