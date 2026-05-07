import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useGridDialogState } from '../../components/grid/hooks/useGridDialogState';

describe('useGridDialogState', () => {
  describe('初期状態', () => {
    it('error=null で全 dialog が閉じている', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      expect(result.current.isErrorDialogOpen).toBe(false);
      expect(result.current.isExportDialogOpen).toBe(false);
      expect(result.current.valueEditor).toEqual({
        isOpen: false,
        rowIndex: 0,
        columnName: '',
        value: null,
      });
    });
  });

  describe('error dialog (useEphemeralOpen 委譲)', () => {
    it('error=truthy で isErrorDialogOpen=true', () => {
      const { result } = renderHook(() => useGridDialogState({ error: 'syntax error' }));

      expect(result.current.isErrorDialogOpen).toBe(true);
    });

    it('dismissErrorDialog → 同 trigger では isErrorDialogOpen=false', () => {
      const { result } = renderHook(() => useGridDialogState({ error: 'syntax error' }));

      act(() => {
        result.current.dismissErrorDialog();
      });

      expect(result.current.isErrorDialogOpen).toBe(false);
    });

    it('dismiss 後に reopen → 再度 isErrorDialogOpen=true', () => {
      const { result } = renderHook(() => useGridDialogState({ error: 'syntax error' }));

      act(() => {
        result.current.dismissErrorDialog();
      });
      act(() => {
        result.current.reopenErrorDialog();
      });

      expect(result.current.isErrorDialogOpen).toBe(true);
    });

    it('error が新しい値に変化すると dismiss 状態がリセットされ自動再 open', () => {
      const { result, rerender } = renderHook(
        ({ error }: { error: string | null }) => useGridDialogState({ error }),
        { initialProps: { error: 'first error' } }
      );

      act(() => {
        result.current.dismissErrorDialog();
      });
      expect(result.current.isErrorDialogOpen).toBe(false);

      rerender({ error: 'second error' });
      expect(result.current.isErrorDialogOpen).toBe(true);
    });
  });

  describe('export dialog', () => {
    it('openExportDialog → isExportDialogOpen=true', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openExportDialog();
      });

      expect(result.current.isExportDialogOpen).toBe(true);
    });

    it('closeExportDialog → isExportDialogOpen=false', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openExportDialog();
      });
      act(() => {
        result.current.closeExportDialog();
      });

      expect(result.current.isExportDialogOpen).toBe(false);
    });
  });

  describe('value editor dialog', () => {
    it('openValueEditor → isOpen=true で payload が反映される', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openValueEditor(3, 'name', 'Alice');
      });

      expect(result.current.valueEditor).toEqual({
        isOpen: true,
        rowIndex: 3,
        columnName: 'name',
        value: 'Alice',
      });
    });

    it('value=null を扱える (NULL 値編集)', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openValueEditor(0, 'description', null);
      });

      expect(result.current.valueEditor.value).toBeNull();
      expect(result.current.valueEditor.isOpen).toBe(true);
    });

    it('closeValueEditor → isOpen=false に戻り payload は維持', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openValueEditor(5, 'email', 'a@b.com');
      });
      act(() => {
        result.current.closeValueEditor();
      });

      expect(result.current.valueEditor).toEqual({
        isOpen: false,
        rowIndex: 5,
        columnName: 'email',
        value: 'a@b.com',
      });
    });

    it('close 後に異なる payload で再 open → 完全置換 (前 payload は残らない)', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openValueEditor(1, 'name', 'Alice');
      });
      act(() => {
        result.current.closeValueEditor();
      });
      act(() => {
        result.current.openValueEditor(2, 'email', 'b@c.com');
      });

      expect(result.current.valueEditor).toEqual({
        isOpen: true,
        rowIndex: 2,
        columnName: 'email',
        value: 'b@c.com',
      });
    });
  });

  describe('独立性', () => {
    it('export と value-editor は独立に open/close できる', () => {
      const { result } = renderHook(() => useGridDialogState({ error: null }));

      act(() => {
        result.current.openExportDialog();
        result.current.openValueEditor(1, 'col', 'v');
      });

      expect(result.current.isExportDialogOpen).toBe(true);
      expect(result.current.valueEditor.isOpen).toBe(true);

      act(() => {
        result.current.closeExportDialog();
      });

      expect(result.current.isExportDialogOpen).toBe(false);
      expect(result.current.valueEditor.isOpen).toBe(true);
    });
  });
});
