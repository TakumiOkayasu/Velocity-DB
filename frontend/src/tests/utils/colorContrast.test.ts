import { describe, expect, it } from 'vitest';
import { blendWithBackground } from '../../utils/colorContrast';

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
