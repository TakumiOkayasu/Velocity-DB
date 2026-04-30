import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type KeyboardShortcutCallbacks,
  useKeyboardShortcutHandler,
} from '../../hooks/useKeyboardShortcutHandler';

function createCallbacks(): KeyboardShortcutCallbacks {
  return {
    onNewQuery: vi.fn(),
    onCloseTab: vi.fn(),
    onExecute: vi.fn(),
    onFormat: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenSettings: vi.fn(),
    onCancel: vi.fn(),
  };
}

function dispatchKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcutHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes onNewQuery on Ctrl+N and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'n', ctrlKey: true });

    expect(cbs.onNewQuery).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('invokes onCloseTab on Ctrl+W and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'w', ctrlKey: true });

    expect(cbs.onCloseTab).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('invokes onExecute on F9 alone and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'F9' });

    expect(cbs.onExecute).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does NOT invoke onExecute on Ctrl+F9', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    dispatchKey({ key: 'F9', ctrlKey: true });

    expect(cbs.onExecute).not.toHaveBeenCalled();
  });

  it('does NOT invoke onExecute on Shift+F9', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    dispatchKey({ key: 'F9', shiftKey: true });

    expect(cbs.onExecute).not.toHaveBeenCalled();
  });

  it('does NOT invoke onExecute on Alt+F9', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    dispatchKey({ key: 'F9', altKey: true });

    expect(cbs.onExecute).not.toHaveBeenCalled();
  });

  it('invokes onFormat on Ctrl+Shift+F and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'F', ctrlKey: true, shiftKey: true });

    expect(cbs.onFormat).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('invokes onOpenSearch on Ctrl+Shift+P and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'P', ctrlKey: true, shiftKey: true });

    expect(cbs.onOpenSearch).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('invokes onOpenSettings on Ctrl+, and prevents default', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: ',', ctrlKey: true });

    expect(cbs.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('invokes onCancel on Escape when isExecuting=true and hasOpenDialog=false', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: true, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'Escape' });

    expect(cbs.onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does NOT invoke onCancel on Escape when isExecuting=false', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    dispatchKey({ key: 'Escape' });

    expect(cbs.onCancel).not.toHaveBeenCalled();
  });

  it('does NOT invoke onCancel on Escape when hasOpenDialog=true', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: true, hasOpenDialog: true })
    );

    dispatchKey({ key: 'Escape' });

    expect(cbs.onCancel).not.toHaveBeenCalled();
  });

  it('prevents default on F5 to block page reload and invokes no callback', () => {
    const cbs = createCallbacks();
    renderHook(() =>
      useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false })
    );

    const event = dispatchKey({ key: 'F5' });

    expect(event.defaultPrevented).toBe(true);
    for (const cb of Object.values(cbs)) {
      expect(cb).not.toHaveBeenCalled();
    }
  });

  it('reflects latest isExecuting/hasOpenDialog after rerender (no stale closure on boolean params)', () => {
    const cbs = createCallbacks();

    const { rerender } = renderHook(
      ({ isExecuting, hasOpenDialog }: { isExecuting: boolean; hasOpenDialog: boolean }) =>
        useKeyboardShortcutHandler({ ...cbs, isExecuting, hasOpenDialog }),
      { initialProps: { isExecuting: false, hasOpenDialog: false } }
    );

    dispatchKey({ key: 'Escape' });
    expect(cbs.onCancel).not.toHaveBeenCalled();

    act(() => {
      rerender({ isExecuting: true, hasOpenDialog: false });
    });
    dispatchKey({ key: 'Escape' });
    expect(cbs.onCancel).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ isExecuting: true, hasOpenDialog: true });
    });
    dispatchKey({ key: 'Escape' });
    expect(cbs.onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses latest callbacks after rerender (no stale closure)', () => {
    const first = createCallbacks();
    const second = createCallbacks();

    const { rerender } = renderHook(
      ({ cbs }: { cbs: KeyboardShortcutCallbacks }) =>
        useKeyboardShortcutHandler({ ...cbs, isExecuting: false, hasOpenDialog: false }),
      { initialProps: { cbs: first } }
    );

    act(() => {
      rerender({ cbs: second });
    });

    dispatchKey({ key: 'n', ctrlKey: true });

    expect(first.onNewQuery).not.toHaveBeenCalled();
    expect(second.onNewQuery).toHaveBeenCalledTimes(1);
  });
});
