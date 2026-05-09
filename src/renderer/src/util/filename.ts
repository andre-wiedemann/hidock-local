// HiDock P1 filename helpers: parsing recording timestamps out of the
// device's two known naming schemes, and grouping by day.
//
// Known schemes:
//   - "REC_20260429_124411.hda"           (older firmware)
//   - "2026Apr29-124411-Rec26.hda"        (current firmware, 2026-05)

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/** Returns `YYYYMMDDHHMMSS` for a recording filename, or '' if unrecognized. */
export function fileTimestampKey(name: string): string {
  let m = name.match(/^REC_(\d{4})(\d{2})(\d{2})_(\d{6})\.hda$/i);
  if (m) return `${m[1]}${m[2]}${m[3]}${m[4]}`;

  m = name.match(/^(\d{4})([A-Za-z]{3})(\d{2})-(\d{6})-Rec\d+\.hda$/i);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()] ?? '00';
    return `${m[1]}${mm}${m[3]}${m[4]}`;
  }
  return '';
}

/** Day-only portion of a recording's timestamp key. */
export function dayKey(name: string): string {
  const k = fileTimestampKey(name);
  return k ? k.slice(0, 8) : '';
}

/** "20260429" → "Apr 29, 2026". */
export function dayLabel(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return 'Unknown date';
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const mo = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const date = new Date(y, mo, d);
  if (isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/** Renames `.hda` → `.mp3` if the user opted in. The payload is the same MP3 bytes either way. */
export function applyExtensionPreference(name: string, useMp3: boolean): string {
  return useMp3 ? name.replace(/\.hda$/i, '.mp3') : name;
}
