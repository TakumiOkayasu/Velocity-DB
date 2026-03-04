import { describe, expect, it, vi } from 'vitest';
import type { Row, Table } from '@tanstack/react-table';
import type { ColumnMeta, RowData } from '../../types/grid';

// Mock useCopyToClipboard
const mockCopyToClipboard = vi.fn();
vi.mock('../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => mockCopyToClipboard,
}));

import { renderHook, act } from '@testing-library/react';
import { useGridContextMenu } from '../../components/grid/hooks/useGridContextMenu';

const mockColumnsMeta: ColumnMeta[] = [
  { name: 'id', comment: 'ID番号', type: 'int' },
  { name: 'name', comment: '名前', type: 'varchar' },
  { name: 'email', comment: '', type: 'varchar' },
];

const mockRows = [
  { original: { __rowIndex: '1', __originalIndex: '0', id: '1', name: 'Alice', email: 'a@b.com' } },
  { original: { __rowIndex: '2', __originalIndex: '1', id: '2', name: "Bob's", email: null } },
] as unknown as Row<RowData>[];

const mockTable = {
  getColumn: vi.fn().mockReturnValue({
    toggleSorting: vi.fn(),
  }),
} as unknown as Table<RowData>;

describe('useGridContextMenu', () => {
  describe('header context menu', () => {
    it('基本メニュー項目が表示される', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openHeaderMenu(
          { preventDefault: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          'id'
        );
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);

      expect(labels).toContain('カラム名をコピー');
      expect(labels).toContain('論理名をコピー');
      expect(labels).toContain('列値をすべてコピー');
      expect(labels).toContain('列値をコピー（ヘッダー付き）');
      expect(labels).toContain('昇順でソート');
      expect(labels).toContain('降順でソート');
    });

    it('論理名がない列では「論理名をコピー」が非表示', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openHeaderMenu(
          { preventDefault: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          'email'
        );
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).not.toContain('論理名をコピー');
    });

    it('列値をすべてコピーが正しいデータをコピー', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openHeaderMenu(
          { preventDefault: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const copyItem = items.find((i) => i.label === '列値をすべてコピー');
      copyItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith("Alice\nBob's", '列データをコピーしました');
    });
  });

  describe('cell context menu', () => {
    it('基本メニュー項目が表示される', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openCellMenu(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          0,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);

      expect(labels).toContain('セル値をコピー');
      expect(labels).toContain('行をコピー（ヘッダー付き）');
      expect(labels).toContain('SQL INSERTとしてコピー');
      expect(labels).toContain('この値でフィルタ');
    });

    it('SQL INSERTコピーが正しいSQL文を生成', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openCellMenu(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          1,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const sqlItem = items.find((i) => i.label === 'SQL INSERTとしてコピー');
      sqlItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "INSERT INTO table_name (id, name, email) VALUES ('2', 'Bob''s', NULL);",
        'SQL INSERTをコピーしました'
      );
    });

    it('isEditMode=true で「NULLに設定」が表示される', () => {
      const mockUpdateCell = vi.fn();
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: true,
          updateCell: mockUpdateCell,
        })
      );

      act(() => {
        result.current.openCellMenu(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          0,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).toContain('NULLに設定');
    });

    it('isEditMode=false で「NULLに設定」が非表示', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openCellMenu(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          0,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).not.toContain('NULLに設定');
    });

    it('列値をコピー（ヘッダー付き）が正しいデータをコピー', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable)
      );

      act(() => {
        result.current.openHeaderMenu(
          { preventDefault: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const copyItem = items.find((i) => i.label === '列値をコピー（ヘッダー付き）');
      copyItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith("name\nAlice\nBob's", '列データをコピーしました');
    });

    it('NULLに設定アクションがupdateCellを呼ぶ', () => {
      const mockUpdateCell = vi.fn();
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: true,
          updateCell: mockUpdateCell,
        })
      );

      act(() => {
        result.current.openCellMenu(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 } as unknown as React.MouseEvent,
          0,
          'name'
        );
      });

      const items = result.current.getMenuItems();
      const nullItem = items.find((i) => i.label === 'NULLに設定');
      nullItem?.action();

      expect(mockUpdateCell).toHaveBeenCalledWith(0, 'name', 'Alice', null);
    });
  });
});
