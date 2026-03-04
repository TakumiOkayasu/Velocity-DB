/** WCAG 2.0 color contrast utilities */

export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) {
    return [
      Number.parseInt(h[0] + h[0], 16),
      Number.parseInt(h[1] + h[1], 16),
      Number.parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length >= 6) {
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export const WCAG_AA = 4.5;

/** Prefer `preferred` if contrast >= WCAG AA, else auto white/dark */
export function readableColor(bgHex: string, preferred?: string): string {
  if (preferred && contrastRatio(bgHex, preferred) >= WCAG_AA) {
    return preferred;
  }
  return relativeLuminance(bgHex) > 0.179 ? '#1e1e1e' : '#ffffff';
}

/** Blend a foreground color with a background using alpha (0-255) */
export function blendWithBackground(fgHex: string, alpha: number, bgHex: string): string {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return bgHex;
  const a = Math.max(0, Math.min(1, alpha / 255));
  const blend = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return `#${blend(fg[0], bg[0]).toString(16).padStart(2, '0')}${blend(fg[1], bg[1]).toString(16).padStart(2, '0')}${blend(fg[2], bg[2]).toString(16).padStart(2, '0')}`;
}

/** Convert hex color + alpha (0-255) to CSS rgba() string */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return 'transparent';
  const a = Math.max(0, Math.min(1, alpha / 255));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

const CONNECTION_PALETTE = [
  '#4caf50',
  '#2196f3',
  '#ff9800',
  '#e91e63',
  '#9c27b0',
  '#00bcd4',
  '#fdd835',
  '#a1887f',
];

/** Deterministic color for a server+database pair */
export function connectionColor(server: string, database: string): string {
  const key = `${server}/${database}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return CONNECTION_PALETTE[Math.abs(hash) % CONNECTION_PALETTE.length];
}
