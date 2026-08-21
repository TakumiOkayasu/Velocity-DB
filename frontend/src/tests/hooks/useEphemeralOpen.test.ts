import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { useEphemeralOpen } from '../../hooks/useEphemeralOpen';

describe('useEphemeralOpen', () => {
  it('trigger が null なら isOpen=false', () => {
    const { result } = renderHook(() => useEphemeralOpen<string | null>(null));
    expect(result.current.isOpen).toBe(false);
  });

  it('trigger が truthy なら isOpen=true', () => {
    const { result } = renderHook(() => useEphemeralOpen<string | null>('err-A'));
    expect(result.current.isOpen).toBe(true);
  });

  it('dismiss() で isOpen=false になる', () => {
    const { result } = renderHook(() => useEphemeralOpen<string | null>('err-A'));
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
  });

  it('dismiss 後 reopen() で再度 isOpen=true', () => {
    const { result } = renderHook(() => useEphemeralOpen<string | null>('err-A'));
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.reopen());
    expect(result.current.isOpen).toBe(true);
  });

  it('trigger が変化すると dismiss 状態がリセットされる (再 open)', () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string | null }) => useEphemeralOpen(trigger),
      { initialProps: { trigger: 'err-A' as string | null } }
    );
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);

    rerender({ trigger: 'err-B' });
    expect(result.current.isOpen).toBe(true);
  });

  it('同じ trigger で rerender しても dismiss 状態は保持される', () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string | null }) => useEphemeralOpen(trigger),
      { initialProps: { trigger: 'err-A' as string | null } }
    );
    act(() => result.current.dismiss());
    rerender({ trigger: 'err-A' });
    expect(result.current.isOpen).toBe(false);
  });

  it('trigger が null になると isOpen=false (dismiss 状態は問わず)', () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string | null }) => useEphemeralOpen(trigger),
      { initialProps: { trigger: 'err-A' as string | null } }
    );
    expect(result.current.isOpen).toBe(true);
    rerender({ trigger: null });
    expect(result.current.isOpen).toBe(false);
  });

  it('null → 新 trigger で isOpen=true', () => {
    const { result, rerender } = renderHook(
      ({ trigger }: { trigger: string | null }) => useEphemeralOpen(trigger),
      { initialProps: { trigger: null as string | null } }
    );
    expect(result.current.isOpen).toBe(false);
    rerender({ trigger: 'err-X' });
    expect(result.current.isOpen).toBe(true);
  });
});
