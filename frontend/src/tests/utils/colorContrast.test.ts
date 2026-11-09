import { connectionColor } from '../../utils/connectionColor';
import theme from '../../styles/global.css?raw';
import { describe, expect, it } from 'vite-plus/test';
import {
  blendWithBackground,
  contrastRatio,
  parseHex,
  readableColor,
  WCAG_AA,
} from '../../utils/colorContrast';

describe('readableColor', () => {
  it('meets AA across mid-tone backgrounds where the former luminance cutoff failed', () => {
    for (let channel = 0; channel <= 255; channel++) {
      const bg = `#${channel.toString(16).padStart(2, '0').repeat(3)}`;
      expect(contrastRatio(bg, readableColor(bg)), bg).toBeGreaterThanOrEqual(WCAG_AA);
    }
    expect(readableColor('#000000', '#eeeeee')).toBe('#eeeeee');
  });
});

const connection = {
  server: 'db.example',
  port: 5432,
  database: 'db_a',
  username: 'user',
  dbType: 'postgresql' as const,
  folderPath: 'Product/Development',
};

function hue(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid color: ${hex}`);
  const [r, g, b] = rgb;
  const max = Math.max(...rgb);
  const delta = max - Math.min(...rgb);
  if (delta === 0) throw new Error(`Expected chromatic color: ${hex}`);
  const sector =
    max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

describe('connectionColor', () => {
  it('keeps connections in the same top-level folder within one hue family', () => {
    const base = hue(connectionColor(connection));
    for (const folderPath of ['Product', 'Product/Production', ' / Product // Development / ']) {
      const actual = hue(connectionColor({ ...connection, folderPath, database: 'db_i' }));
      const distance = Math.abs(base - actual);
      expect(Math.min(distance, 360 - distance)).toBeLessThanOrEqual(40);
    }
    expect(connectionColor({ ...connection, folderPath: ' / Product // Development / ' })).toBe(
      connectionColor(connection)
    );
  });

  it('distinguishes DB identities and does not cycle through a small fixed palette', () => {
    const colors = Array.from({ length: 24 }, (_, i) =>
      connectionColor({ ...connection, database: `db_${i}` })
    );
    expect(new Set(colors).size).toBeGreaterThan(8);
    for (const change of [
      { database: 'db_i' },
      { port: 5433 },
      { dbType: 'mysql' as const },
      { username: 'other' },
    ]) {
      expect(connectionColor({ ...connection, ...change })).not.toBe(connectionColor(connection));
    }
    expect(connectionColor({ ...connection, folderPath: 'Other' })).not.toBe(
      connectionColor(connection)
    );
    expect(connectionColor({ ...connection, folderPath: undefined })).toBe(
      connectionColor({ ...connection, folderPath: '' })
    );
  });

  it('keeps generated text accents readable on the dark theme including hover', () => {
    const hover = theme.match(/--bg-hover:\s*(#[0-9a-f]+)/i)?.[1];
    if (!hover) throw new Error('Theme hover color missing');
    for (let i = 0; i < 360; i++) {
      const color = connectionColor({ ...connection, folderPath: `Folder-${i}` });
      expect(contrastRatio(color, hover), color).toBeGreaterThanOrEqual(WCAG_AA);
    }
  });
});

describe('blendWithBackground', () => {
  it('fully opaque returns foreground', () => {
    expect(blendWithBackground('#ff0000', 255, '#0000ff')).toBe('#ff0000');
  });

  it('fully transparent returns background', () => {
    expect(blendWithBackground('#ff0000', 0, '#0000ff')).toBe('#0000ff');
  });

  it('50% alpha blends correctly', () => {
    // 128/255 ≈ 0.502; red channel: round(255*0.502 + 0*0.498) = 128 = 0x80
    expect(blendWithBackground('#ff0000', 128, '#000000')).toBe('#800000');
  });

  it('invalid foreground hex returns background', () => {
    expect(blendWithBackground('invalid', 128, '#000000')).toBe('#000000');
  });

  it('invalid background hex returns background string', () => {
    expect(blendWithBackground('#ff0000', 128, 'invalid')).toBe('invalid');
  });
});
