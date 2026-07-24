import { describe, expect, it } from 'vitest';
import { computeWindowRange } from '../../utils/computeWindowRange';

describe('computeWindowRange', () => {
  it('行数 0 なら空範囲を返す', () => {
    expect(computeWindowRange(0, 600, 30, 0, 10)).toEqual({ start: 0, end: 0 });
  });

  it('rowHeight が 0 以下なら空範囲を返す (0 除算防止)', () => {
    expect(computeWindowRange(0, 600, 0, 100, 10)).toEqual({ start: 0, end: 0 });
    expect(computeWindowRange(0, 600, -5, 100, 10)).toEqual({ start: 0, end: 0 });
  });

  it('スクロール位置 0 では先頭行から可視行数 + overscan を返す', () => {
    // viewport 300 / rowHeight 30 = 10 行 + 部分表示 1 行 + overscan 5
    expect(computeWindowRange(0, 300, 30, 1000, 5)).toEqual({ start: 0, end: 16 });
  });

  it('スクロール中間では前後 overscan を含む範囲を返す', () => {
    // scrollTop 900 → 先頭可視行 30。start = 30-5, end = 30+11+5
    expect(computeWindowRange(900, 300, 30, 1000, 5)).toEqual({ start: 25, end: 46 });
  });

  it('行境界の途中のスクロール位置は切り捨てて先頭可視行を決める', () => {
    expect(computeWindowRange(929, 300, 30, 1000, 0)).toEqual({ start: 30, end: 41 });
  });

  it('負の scrollTop (オーバースクロール) は 0 として扱う', () => {
    expect(computeWindowRange(-120, 300, 30, 1000, 5)).toEqual({ start: 0, end: 16 });
  });

  it('末尾付近では end を行数でクランプする', () => {
    expect(computeWindowRange(29_700, 300, 30, 1000, 5)).toEqual({ start: 985, end: 1000 });
  });

  it('コンテンツ末尾を超える scrollTop でも start <= end の有効範囲を返す', () => {
    const range = computeWindowRange(999_999, 300, 30, 1000, 5);
    expect(range.start).toBeLessThanOrEqual(range.end);
    expect(range.end).toBe(1000);
    expect(range.start).toBe(994); // 最終行 999 - overscan 5
  });

  it('viewport 高さ 0 でも最低 1 行は描画対象に含める', () => {
    expect(computeWindowRange(0, 0, 30, 1000, 0)).toEqual({ start: 0, end: 1 });
  });

  it('行数が viewport より少なければ全行を返す', () => {
    expect(computeWindowRange(0, 600, 30, 3, 10)).toEqual({ start: 0, end: 3 });
  });

  it('負の overscan は 0 として扱う', () => {
    expect(computeWindowRange(900, 300, 30, 1000, -5)).toEqual({ start: 30, end: 41 });
  });
});
