// On-screen debug log + matching console.log mirror.

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

let logEl: HTMLDivElement | null = null;

function ensureLogEl(): HTMLDivElement | null {
  if (!logEl) logEl = document.getElementById('log') as HTMLDivElement | null;
  return logEl;
}

export function log(message: string, level: LogLevel = 'info'): void {
  const el = ensureLogEl();
  if (el) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
  }
  // Mirror to devtools so we can see it without the panel open.
  // eslint-disable-next-line no-console
  console.log(message);
}

export function wireLogControls(): void {
  document.getElementById('toggleLogBtn')?.addEventListener('click', () => {
    const el = ensureLogEl();
    if (!el) return;
    const current = el.style.display;
    el.style.display = current === 'none' || current === '' ? 'block' : 'none';
  });
  document.getElementById('clearLogBtn')?.addEventListener('click', () => {
    const el = ensureLogEl();
    if (el) el.innerHTML = '';
  });
}
