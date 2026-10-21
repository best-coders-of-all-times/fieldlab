/** Formatting helpers. All physics is SI; formatting only changes presentation. */

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '',
};

export function superscript(n: number): string {
  return String(n).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
}

export function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Compact scientific formatting, e.g. 1.23×10⁴. */
export function formatSci(value: number, sig = 3): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e-2 && abs < 1e5) {
    const s = value.toPrecision(sig);
    return trimZeros(s);
  }
  const exp = Math.floor(Math.log10(abs));
  const mant = value / 10 ** exp;
  return `${trimZeros(mant.toFixed(Math.max(0, sig - 1)))}×10${superscript(exp)}`;
}

export function formatSI(value: number, unit: string, sig = 3): string {
  if (!Number.isFinite(value)) return '—';
  const body = formatSci(value, sig);
  return unit ? `${body} ${unit}` : body;
}

const PREFIXES: Array<[number, string]> = [
  [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** Engineering notation with metric prefix, e.g. 2.4 nC. */
export function formatPrefixed(value: number, unit: string, sig = 3): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return unit ? `0 ${unit}` : '0';
  const abs = Math.abs(value);
  let chosen = PREFIXES[PREFIXES.length - 1];
  for (const p of PREFIXES) {
    if (abs >= p[0]) { chosen = p; break; }
  }
  const scaled = value / chosen[0];
  return `${trimZeros(scaled.toPrecision(sig))} ${chosen[1]}${unit}`;
}

export function formatLength(m: number): string {
  return formatPrefixed(m, 'm');
}

export function formatTime(s: number): string {
  if (Math.abs(s) < 1e-9 && s !== 0) return formatPrefixed(s, 's');
  return formatPrefixed(s, 's');
}

export function formatPercent(x: number, sig = 3): string {
  return `${trimZeros((x * 100).toPrecision(sig))}%`;
}

export function formatDegrees(rad: number): string {
  return `${trimZeros(((rad * 180) / Math.PI).toPrecision(4))}°`;
}

export function formatVector(v: readonly number[], unit = '', sig = 2): string {
  return `(${v.map((x) => formatSci(x, sig)).join(', ')})${unit ? ` ${unit}` : ''}`;
}

/** Parse a number from an input, accepting 1e-3, 2.5e6, etc. */
export function parseNumber(text: string, fallback = 0): number {
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}
