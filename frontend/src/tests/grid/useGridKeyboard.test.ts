import type { ColumnDef } from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridKeyboard } from '../../components/grid/hooks/useGridKeyboard';
import type { RowData } from '../../types/grid';

// --- Mocks ---
const mockCopyToClipboard = vi.fn();

vi.mock('../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => mockCopyToClipboard,
}));

let capturedKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
vi.mock('../../hooks/useKeyboardHandler', () => ({
  useKeyboardHandler: (handler: (e: KeyboardEvent) => void) => {
    capturedKeydownHandler = handler;
  },
}));

vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn() },
}));

// --- Test data ---
const testColumns: ColumnDef<RowData>[] = [
  { id: 'col_a', header: 'Column A', accessorKey: 'col_a' },
  { id: 'col_b', header: 'Column B', accessorKey: 'col_b' },
];

const testRowData: RowData[] = [
  { __rowIndex: '1', __originalIndex: '0', col_a: 'A1', col_b: 'B1' },
  { __rowIndex: '2', __originalIndex: '1', col_a: 'A2', col_b: 'B2' },
  { __rowIndex: '3', __originalIndex: '2', col_a: 'A3', col_b: null },
];

const baseOptions = {
  isEditMode: false,
  selectedRows: new Set<number>(),
  selectedColumns: new Set<string>(),
  columns: testColumns,
  rowData: testRowData,
  getRowByViewIndex: (i: number) => testRowData[i],
  tableContainerRef: { current: null },
  updateCell: vi.fn(),
  onDeleteRow: vi.fn(),
  onCloneRow: vi.fn(),
  onInsertRow: vi.fn(),
  onApplyChanges: vi.fn().mockResolvedValue(undefined),
};

describe('useGridKeyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedKeydownHandler = null;
  });

  describe('Ctrl+A', () => {
    it('onSelectAll を呼び preventDefault する', () => {
      const onSelectAll = vi.fn();
      renderHook(() => useGridKeyboard({ ...baseOptions, onSelectAll }));

      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      capturedKeydownHandler?.(event);

      expect(onSelectAll).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('Shift を伴う Ctrl+Shift+A は処理しない', () => {
      const onSelectAll = vi.fn();
      renderHook(() => useGridKeyboard({ ...baseOptions, onSelectAll }));

      const event = new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true });
      capturedKeydownHandler?.(event);

      expect(onSelectAll).not.toHaveBeenCalled();
    });

    it('INPUT フォーカス中は onSelectAll を呼ばず既定動作を許可する', () => {
      const onSelectAll = vi.fn();
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      try {
        renderHook(() => useGridKeyboard({ ...baseOptions, onSelectAll }));
        const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
        const preventDefault = vi.spyOn(event, 'preventDefault');
        capturedKeydownHandler?.(event);

        expect(onSelectAll).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(input);
      }
    });
  });

  describe('copySelection', () => {
    it('1列選択コピー → 改行区切り値', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([0, 1, 2]),
          selectedColumns: new Set(['col_a']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('A1\nA2\nA3', '3件の値をコピーしました');
    });

    it('複数列選択コピー → ヘッダー付きTSV', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([0, 1]),
          selectedColumns: new Set(['col_a', 'col_b']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Column A\tColumn B\nA1\tB1\nA2\tB2',
        '2列 × 2行をコピーしました'
      );
    });

    it('列選択なし → 全列TSV', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([0]),
          selectedColumns: new Set(),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Column A\tColumn B\nA1\tB1',
        '1行をコピーしました'
      );
    });

    it('同一列セル範囲コピー → 部分行の値リスト', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([1, 2]),
          selectedColumns: new Set(['col_a']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('A2\nA3', '2件の値をコピーしました');
    });

    it('NULL値は "NULL" 文字列としてコピーされる', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([2]),
          selectedColumns: new Set(['col_b']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('NULL', '1件の値をコピーしました');
    });

    it('選択行なし → コピーしない', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set(),
          selectedColumns: new Set(['col_a']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).not.toHaveBeenCalled();
    });

    it('ソート後のビュー順でコピーされる', async () => {
      const reorderedView = [testRowData[2], testRowData[0], testRowData[1]];
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([0, 1]),
          selectedColumns: new Set(['col_a']),
          getRowByViewIndex: (i: number) => reorderedView[i],
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('A3\nA1', '2件の値をコピーしました');
    });

    it('__rowIndex が selectedColumns に含まれても columns 順フィルタで除外される', async () => {
      const { result } = renderHook(() =>
        useGridKeyboard({
          ...baseOptions,
          selectedRows: new Set([0, 1]),
          selectedColumns: new Set(['__rowIndex']),
        })
      );

      await act(async () => {
        await result.current.copySelection();
      });

      // __rowIndex は columns 定義に含まれないため cols が空 → 全列TSVフォールバック
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Column A\tColumn B\nA1\tB1\nA2\tB2',
        '2行をコピーしました'
      );
    });
  });

  describe('startEdit', () => {
    it('__rowIndex 列では編集を開始しない', () => {
      const { result } = renderHook(() => useGridKeyboard({ ...baseOptions, isEditMode: true }));

      act(() => {
        result.current.startEdit(0, '__rowIndex', '1');
      });

      expect(result.current.editingCell).toBeNull();
    });

    it('通常列では編集を開始する', () => {
      const { result } = renderHook(() => useGridKeyboard({ ...baseOptions, isEditMode: true }));

      act(() => {
        result.current.startEdit(0, 'col_a', 'A1');
      });

      expect(result.current.editingCell).toEqual({ rowIndex: 0, columnId: 'col_a' });
      expect(result.current.editValue).toBe('A1');
    });
  });
});
