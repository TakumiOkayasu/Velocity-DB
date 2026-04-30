import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableUIState } from '../../components/table/hooks/useTableUIState';

describe('useTableUIState', () => {
  it('returns default initial values', () => {
    const { result } = renderHook(() => useTableUIState());

    expect(result.current.activeTab).toBe('data');
    expect(result.current.showLogicalNames).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('updates activeTab via setActiveTab', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setActiveTab('columns');
    });

    expect(result.current.activeTab).toBe('columns');
  });

  it('toggles showLogicalNames via setShowLogicalNames', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setShowLogicalNames(true);
    });
    expect(result.current.showLogicalNames).toBe(true);

    act(() => {
      result.current.setShowLogicalNames(false);
    });
    expect(result.current.showLogicalNames).toBe(false);
  });

  it('updates isLoading via setIsLoading', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setIsLoading(true);
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('updates error via setError', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setError('connection failed');
    });

    expect(result.current.error).toBe('connection failed');
  });

  it('clears error when set to null', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setError('some error');
    });
    expect(result.current.error).toBe('some error');

    act(() => {
      result.current.setError(null);
    });
    expect(result.current.error).toBeNull();
  });

  it('keeps each state independent', () => {
    const { result } = renderHook(() => useTableUIState());

    act(() => {
      result.current.setActiveTab('source');
    });

    expect(result.current.activeTab).toBe('source');
    expect(result.current.showLogicalNames).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
