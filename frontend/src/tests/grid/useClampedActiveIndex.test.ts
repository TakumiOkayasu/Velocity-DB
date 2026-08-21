import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { useClampedActiveIndex } from '../../components/grid/hooks/useClampedActiveIndex';

describe('useClampedActiveIndex', () => {
  it('初期 activeIndex は 0', () => {
    const { result } = renderHook(() => useClampedActiveIndex(5));
    expect(result.current[0]).toBe(0);
  });

  it('setter で activeIndex を更新できる', () => {
    const { result } = renderHook(() => useClampedActiveIndex(5));
    act(() => {
      result.current[1](3);
    });
    expect(result.current[0]).toBe(3);
  });

  it('length が減って範囲外になったら 0 に戻る', () => {
    const { result, rerender } = renderHook(({ length }) => useClampedActiveIndex(length), {
      initialProps: { length: 6 },
    });
    act(() => {
      result.current[1](5);
    });
    expect(result.current[0]).toBe(5);

    rerender({ length: 2 });
    expect(result.current[0]).toBe(0);
  });

  it('length が増えた場合は現在の index を維持する', () => {
    const { result, rerender } = renderHook(({ length }) => useClampedActiveIndex(length), {
      initialProps: { length: 3 },
    });
    act(() => {
      result.current[1](2);
    });
    expect(result.current[0]).toBe(2);

    rerender({ length: 6 });
    expect(result.current[0]).toBe(2);
  });

  it('length が 0 になったら activeIndex も 0 に戻る', () => {
    const { result, rerender } = renderHook(({ length }) => useClampedActiveIndex(length), {
      initialProps: { length: 3 },
    });
    act(() => {
      result.current[1](2);
    });
    rerender({ length: 0 });
    expect(result.current[0]).toBe(0);
  });
});
