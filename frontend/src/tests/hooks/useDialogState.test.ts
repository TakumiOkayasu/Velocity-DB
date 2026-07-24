import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDialogState } from '../../hooks/useDialogState';

describe('useDialogState', () => {
  it('初期状態 → 全 dialog が閉じており hasOpenDialog が false', () => {
    const { result } = renderHook(() => useDialogState());

    expect(result.current.isConnectionDialogOpen).toBe(false);
    expect(result.current.isSearchDialogOpen).toBe(false);
    expect(result.current.isSettingsDialogOpen).toBe(false);
    expect(result.current.queryConfirm).toEqual({
      isOpen: false,
      title: '',
      message: '',
    });
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('openConnectionDialog → isConnectionDialogOpen と hasOpenDialog が true', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openConnectionDialog();
    });

    expect(result.current.isConnectionDialogOpen).toBe(true);
    expect(result.current.hasOpenDialog).toBe(true);
  });

  it('closeConnectionDialog → open 後 close で isConnectionDialogOpen が false に戻る', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openConnectionDialog();
    });
    act(() => {
      result.current.closeConnectionDialog();
    });

    expect(result.current.isConnectionDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('openSearchDialog / closeSearchDialog → isSearchDialogOpen が独立に切り替わる', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openSearchDialog();
    });
    expect(result.current.isSearchDialogOpen).toBe(true);
    expect(result.current.isConnectionDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(true);

    act(() => {
      result.current.closeSearchDialog();
    });
    expect(result.current.isSearchDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('openSettingsDialog / closeSettingsDialog → isSettingsDialogOpen が独立に切り替わる', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openSettingsDialog();
    });
    expect(result.current.isSettingsDialogOpen).toBe(true);
    expect(result.current.isSearchDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(true);

    act(() => {
      result.current.closeSettingsDialog();
    });
    expect(result.current.isSettingsDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('openDataCompareDialog / closeDataCompareDialog → isDataCompareDialogOpen が独立に切り替わる', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openDataCompareDialog();
    });
    expect(result.current.isDataCompareDialogOpen).toBe(true);
    expect(result.current.isSettingsDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(true);

    act(() => {
      result.current.closeDataCompareDialog();
    });
    expect(result.current.isDataCompareDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('openQueryConfirm → 渡した値が反映され isOpen が true', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openQueryConfirm({
        title: '本番環境警告',
        message: '本当に実行しますか?',
        details: 'DROP TABLE users',
        isBlocked: false,
      });
    });

    expect(result.current.queryConfirm).toEqual({
      isOpen: true,
      title: '本番環境警告',
      message: '本当に実行しますか?',
      details: 'DROP TABLE users',
      isBlocked: false,
    });
  });

  it('openQueryConfirm 単独 → hasOpenDialog は false のまま (現状の振る舞いを維持)', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openQueryConfirm({
        title: '読み取り専用モード',
        message: 'UPDATE は実行できません',
      });
    });

    expect(result.current.queryConfirm.isOpen).toBe(true);
    expect(result.current.hasOpenDialog).toBe(false);
  });

  it('closeQueryConfirm → isOpen が false に戻り title/message も初期値にリセット', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openQueryConfirm({
        title: '本番環境警告',
        message: 'DROP TABLE は禁止されています',
        details: 'DROP TABLE users',
        isBlocked: true,
      });
    });
    act(() => {
      result.current.closeQueryConfirm();
    });

    expect(result.current.queryConfirm).toEqual({
      isOpen: false,
      title: '',
      message: '',
    });
  });

  it('複数 dialog 同時 open → 各 isXxxOpen が独立に true、hasOpenDialog も true', () => {
    const { result } = renderHook(() => useDialogState());

    act(() => {
      result.current.openConnectionDialog();
      result.current.openSettingsDialog();
    });

    expect(result.current.isConnectionDialogOpen).toBe(true);
    expect(result.current.isSettingsDialogOpen).toBe(true);
    expect(result.current.isSearchDialogOpen).toBe(false);
    expect(result.current.hasOpenDialog).toBe(true);
  });
});
