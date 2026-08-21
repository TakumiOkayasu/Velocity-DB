import { describe, expect, it, vi } from 'vite-plus/test';
import type { ColumnMeta } from '../../types/grid';

// Mock useCopyToClipboard
const mockCopyToClipboard = vi.fn();
vi.mock('../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => mockCopyToClipboard,
}));

import { act, renderHook } from '@testing-library/react';
import type {
  GridMouseEvent,
  GridRow,
  GridTable,
} from '../../components/grid/hooks/useGridContextMenu';
import {
  buildMarkdownTable,
  useGridContextMenu,
} from '../../components/grid/hooks/useGridContextMenu';

const mockColumnsMeta: ColumnMeta[] = [
  { name: 'id', comment: 'ID番号', type: 'int' },
  { name: 'name', comment: '名前', type: 'varchar' },
  { name: 'email', comment: '', type: 'varchar' },
];

const mockRows: GridRow[] = [
  { original: { __rowIndex: '1', __originalIndex: '0', id: '1', name: 'Alice', email: 'a@b.com' } },
  { original: { __rowIndex: '2', __originalIndex: '1', id: '2', name: "Bob's", email: null } },
];

const mockTable: GridTable = {
  getColumn: vi.fn().mockReturnValue({
    toggleSorting: vi.fn(),
  }),
};

function createMockEvent(): GridMouseEvent {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100, clientY: 200 };
}

describe('buildMarkdownTable', () => {
  it('単一列・単一行のテーブルを生成', () => {
    expect(buildMarkdownTable(['a'], [['1']])).toBe('| a |\n| --- |\n| 1 |');
  });

  it('複数列・複数行のテーブルを生成', () => {
    expect(
      buildMarkdownTable(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ]
      )
    ).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('ヘッダーのパイプもエスケープする', () => {
    expect(buildMarkdownTable(['a|b'], [['1']])).toBe('| a\\|b |\n| --- |\n| 1 |');
  });

  it('CRLF 改行を <br> にエスケープする', () => {
    expect(buildMarkdownTable(['a'], [['x\r\ny']])).toBe('| a |\n| --- |\n| x<br>y |');
  });
});

describe('useGridContextMenu', () => {
  describe('header context menu', () => {
    it('基本メニュー項目が表示される', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'id');
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
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'email');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).not.toContain('論理名をコピー');
    });

    it('onAutoSizeColumn/onAutoSizeColumns 指定でオートアジャストメニューが表示され、アクションが呼ばれる', () => {
      const onAutoSizeColumn = vi.fn();
      const onAutoSizeColumns = vi.fn();
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: false,
          onAutoSizeColumn,
          onAutoSizeColumns,
        })
      );

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).toContain('この列をオートアジャスト');
      expect(labels).toContain('全列をオートアジャスト');

      items.find((i) => i.label === 'この列をオートアジャスト')?.action();
      expect(onAutoSizeColumn).toHaveBeenCalledWith('name');

      items.find((i) => i.label === '全列をオートアジャスト')?.action();
      expect(onAutoSizeColumns).toHaveBeenCalledTimes(1);
    });

    it('onAutoSizeColumn/onAutoSizeColumns 未指定ではオートアジャストメニューが非表示', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).not.toContain('この列をオートアジャスト');
      expect(labels).not.toContain('全列をオートアジャスト');
    });

    it('列値をすべてコピーが正しいデータをコピー', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      const copyItem = items.find((i) => i.label === '列値をすべてコピー');
      copyItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith("Alice\nBob's", '列データをコピーしました');
    });
  });

  describe('cell context menu', () => {
    it('基本メニュー項目が表示される', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openCellMenu(createMockEvent(), 0, 'name');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);

      expect(labels).toContain('セル値をコピー');
      expect(labels).toContain('行をコピー（ヘッダー付き）');
      expect(labels).toContain('SQL INSERTとしてコピー');
      expect(labels).toContain('この値でフィルタ');
    });

    it('行をコピー（ヘッダー付き）が Markdown 形式でコピー', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openCellMenu(createMockEvent(), 1, 'name');
      });

      const items = result.current.getMenuItems();
      const rowItem = items.find((i) => i.label === '行をコピー（ヘッダー付き）');
      rowItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "| id | name | email |\n| --- | --- | --- |\n| 2 | Bob's | NULL |",
        '行をコピーしました'
      );
    });

    it('SQL INSERTコピーが正しいSQL文を生成', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openCellMenu(createMockEvent(), 1, 'name');
      });

      const items = result.current.getMenuItems();
      const sqlItem = items.find((i) => i.label === 'SQL INSERTとしてコピー');
      sqlItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "INSERT INTO table_name (id, name, email) VALUES ('2', 'Bob''s', NULL);",
        'SQL INSERTをコピーしました'
      );
    });

    it('SQL INSERTコピーが tableName 指定時は実テーブル名を埋め込む', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: false,
          tableName: 'users',
        })
      );

      act(() => {
        result.current.openCellMenu(createMockEvent(), 1, 'name');
      });

      const items = result.current.getMenuItems();
      const sqlItem = items.find((i) => i.label === 'SQL INSERTとしてコピー');
      sqlItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "INSERT INTO users (id, name, email) VALUES ('2', 'Bob''s', NULL);",
        'SQL INSERTをコピーしました'
      );
    });

    it('SQL INSERTコピーがブラケット付きテーブル名をそのまま埋め込む', () => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: false,
          tableName: '[db].[dbo].[users]',
        })
      );

      act(() => {
        result.current.openCellMenu(createMockEvent(), 1, 'name');
      });

      const items = result.current.getMenuItems();
      const sqlItem = items.find((i) => i.label === 'SQL INSERTとしてコピー');
      sqlItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "INSERT INTO [db].[dbo].[users] (id, name, email) VALUES ('2', 'Bob''s', NULL);",
        'SQL INSERTをコピーしました'
      );
    });

    it.each([
      ['空文字', ''],
      ['セミコロン混入', 'users; DROP TABLE x;'],
      ['改行混入', 'a\nb'],
    ])('SQL INSERTコピーが不正な tableName (%s) では table_name にフォールバック', (_, bad) => {
      const { result } = renderHook(() =>
        useGridContextMenu(mockColumnsMeta, mockRows, mockTable, {
          isEditMode: false,
          tableName: bad,
        })
      );

      act(() => {
        result.current.openCellMenu(createMockEvent(), 1, 'name');
      });

      const items = result.current.getMenuItems();
      items.find((i) => i.label === 'SQL INSERTとしてコピー')?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO table_name '),
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
        result.current.openCellMenu(createMockEvent(), 0, 'name');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).toContain('NULLに設定');
    });

    it('isEditMode=false で「NULLに設定」が非表示', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openCellMenu(createMockEvent(), 0, 'name');
      });

      const items = result.current.getMenuItems();
      const labels = items.filter((i) => !i.separator).map((i) => i.label);
      expect(labels).not.toContain('NULLに設定');
    });

    it('列値をコピー（ヘッダー付き）が Markdown 形式でコピー', () => {
      const { result } = renderHook(() => useGridContextMenu(mockColumnsMeta, mockRows, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      const copyItem = items.find((i) => i.label === '列値をコピー（ヘッダー付き）');
      copyItem?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "| name |\n| --- |\n| Alice |\n| Bob's |",
        '列データをコピーしました'
      );
    });

    it('列値をコピー（ヘッダー付き）がパイプ文字をエスケープする', () => {
      const piped: GridRow[] = [
        { original: { __rowIndex: '1', __originalIndex: '0', name: 'a|b' } },
      ];
      const pipedCols: ColumnMeta[] = [{ name: 'name', comment: '', type: 'varchar' }];
      const { result } = renderHook(() => useGridContextMenu(pipedCols, piped, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      items.find((i) => i.label === '列値をコピー（ヘッダー付き）')?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        '| name |\n| --- |\n| a\\|b |',
        '列データをコピーしました'
      );
    });

    it('列値をコピー（ヘッダー付き）が改行を <br> にエスケープする', () => {
      const rowsWithNewline: GridRow[] = [
        { original: { __rowIndex: '1', __originalIndex: '0', name: 'a\nb' } },
      ];
      const cols: ColumnMeta[] = [{ name: 'name', comment: '', type: 'varchar' }];
      const { result } = renderHook(() => useGridContextMenu(cols, rowsWithNewline, mockTable));

      act(() => {
        result.current.openHeaderMenu(createMockEvent(), 'name');
      });

      const items = result.current.getMenuItems();
      items.find((i) => i.label === '列値をコピー（ヘッダー付き）')?.action();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        '| name |\n| --- |\n| a<br>b |',
        '列データをコピーしました'
      );
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
        result.current.openCellMenu(createMockEvent(), 0, 'name');
      });

      const items = result.current.getMenuItems();
      const nullItem = items.find((i) => i.label === 'NULLに設定');
      nullItem?.action();

      expect(mockUpdateCell).toHaveBeenCalledWith(0, 'name', 'Alice', null);
    });
  });
});
