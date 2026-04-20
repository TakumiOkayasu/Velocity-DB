import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardHandler } from '../../hooks/useKeyboardHandler';

describe('useKeyboardHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers keydown listener on window', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const handler = vi.fn();

    const { unmount } = renderHook(() => useKeyboardHandler(handler));

    expect(addSpy.mock.calls.find((c) => c[0] === 'keydown')).toBeDefined();

    unmount();
    expect(removeSpy.mock.calls.find((c) => c[0] === 'keydown')).toBeDefined();
  });

  it('registers keydown listener in capture phase to bypass Monaco stopPropagation', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const handler = vi.fn();

    renderHook(() => useKeyboardHandler(handler));

    const addCall = addSpy.mock.calls.find((c) => c[0] === 'keydown');
    expect(addCall).toBeDefined();
    // 3rd arg is either `true` (capture) or `{ capture: true }`
    const useCapture = addCall?.[2];
    const isCapture =
      useCapture === true ||
      (typeof useCapture === 'object' && useCapture !== null && useCapture.capture === true);
    expect(isCapture).toBe(true);
  });

  it('removes listener with same capture flag on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const handler = vi.fn();

    const { unmount } = renderHook(() => useKeyboardHandler(handler));
    unmount();

    const addCall = addSpy.mock.calls.find((c) => c[0] === 'keydown');
    const removeCall = removeSpy.mock.calls.find((c) => c[0] === 'keydown');
    // add と remove は同じ capture フラグでないとリスナー解除されない
    expect(removeCall?.[2]).toEqual(addCall?.[2]);
  });

  it('invokes handler on keydown event', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardHandler(handler));

    const event = new KeyboardEvent('keydown', { key: 'F9' });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(event);
  });

  it('does not invoke handler when activeElement is outside containerRef', () => {
    const handler = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const containerRef = { current: container };

    renderHook(() => useKeyboardHandler(handler, containerRef));

    // document.body is outside container → handler must not fire
    expect(container.contains(document.activeElement)).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(container);
  });

  it('invokes handler when activeElement is inside containerRef', () => {
    const handler = vi.fn();
    const container = document.createElement('div');
    const child = document.createElement('button');
    container.appendChild(child);
    document.body.appendChild(container);
    const containerRef = { current: container };

    renderHook(() => useKeyboardHandler(handler, containerRef));

    child.focus();
    expect(container.contains(document.activeElement)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));

    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });

  it('always uses the latest handler (no stale closures)', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const { rerender } = renderHook(
      ({ h }: { h: (e: KeyboardEvent) => void }) => useKeyboardHandler(h),
      { initialProps: { h: firstHandler } }
    );

    // rerender + ref sync effect を flush するため act でラップ
    act(() => {
      rerender({ h: secondHandler });
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });
});
