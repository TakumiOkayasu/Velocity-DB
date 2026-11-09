import type { Connection } from '../types';
import { normalizedFolderSegments } from './folderPath';

type ColorIdentity = Pick<
  Connection,
  'server' | 'port' | 'database' | 'username' | 'dbType' | 'folderPath'
>;

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  }
  // Mix the high bits too: adjacent folder names must not produce adjacent hues.
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

function hueForFolder(path: string, fallback: string): number {
  const segments = normalizedFolderSegments(path);
  const parent = (hash(segments[0] ?? fallback) / 2 ** 32) * 360;
  const child = segments.length > 1 ? (hash(segments.join('/')) / 2 ** 32 - 0.5) * 16 : 0;
  return parent + child;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (hue + 360) % 360;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + h / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Parent folders share a hue family; descendants vary within it. */
export function folderColor(path: string): string {
  return hslToHex(hueForFolder(path, ''), 0.65, 0.82);
}

/** Stable across reconnects and profile renames, with no stored palette or secrets. */
export function connectionColor(connection: ColorIdentity): string {
  const identity = hash(
    JSON.stringify([
      connection.dbType ?? 'sqlserver',
      connection.server,
      connection.port,
      connection.database,
      connection.username,
    ])
  );
  const hue =
    hueForFolder(connection.folderPath ?? '', connection.server) + (identity / 2 ** 32 - 0.5) * 20;
  // Opaque pastel accents preserve text contrast on the dark theme, including hover.
  return hslToHex(hue, 0.55 + (identity % 101) / 500, 0.84 + ((identity >>> 8) % 61) / 1000);
}
