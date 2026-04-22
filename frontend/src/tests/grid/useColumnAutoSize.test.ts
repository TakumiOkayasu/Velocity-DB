import type { ColumnDef } from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useColumnAutoSize } from '../../components/grid/hooks/useColumnAutoSize';
import type { ResultSet } from '../../types';
import type { RowData } from '../../types/grid';

function makeResultSet(cols: Array<{ name: string; type: string }>, rows: string[][]): ResultSet {
  return {
    columns: cols.map((c) => ({
      name: c.name,
      type: c.type,
      size: 0,
      nullable: true,
      isPrimaryKey: false,
    })),
    rows,
    affectedRows: 0,
    executionTimeMs: 0,
  };
}

function makeRowData(cols: string[], rows: string[][]): RowData[] {
  return rows.map((row, i) => {
    const obj: RowData = {
      __rowIndex: String(i + 1),
      __originalIndex: String(i),
    };
    for (let c = 0; c < cols.length; c++) {
      obj[cols[c]] = row[c];
    }
    return obj;
  });
}

function makeColumns(cols: string[]): ColumnDef<RowData>[] {
  return cols.map((name) => ({
    id: name,
    header: name,
    accessorKey: name,
    size: 150,
    minSize: 80,
  }));
}

describe('useColumnAutoSize', () => {
  it('初回 resultSet (rows あり) で columnSizing が計算される', () => {
    const resultSet = makeResultSet([{ name: 'a', type: 'int' }], [['10'], ['2000000000']]);
    const columns = makeColumns(['a']);
    const rowData = makeRowData(['a'], [['10'], ['2000000000']]);

    const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

    expect(result.current.columnSizing.a).toBeGreaterThan(0);
  });

  it('rows が空の resultSet では計算をスキップする', () => {
    const resultSet = makeResultSet([{ name: 'a', type: 'int' }], []);
    const columns = makeColumns(['a']);
    const rowData: RowData[] = [];

    const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

    expect(result.current.columnSizing).toEqual({});
  });

  it('同じ columnsKey (name:type) の resultSet 差替では columnSizing が再計算されない', () => {
    const cols = [{ name: 'a', type: 'int' }];
    const columns = makeColumns(['a']);
    const initial = {
      resultSet: makeResultSet(cols, [['1'], ['2']]),
      columns,
      rowData: makeRowData(['a'], [['1'], ['2']]),
    };

    const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
      initialProps: initial,
    });

    const first = result.current.columnSizing;
    expect(first.a).toBeGreaterThan(0);

    // resultSet identity は変わるが name:type は同じ (infinite scroll 等を想定)
    rerender({
      resultSet: makeResultSet(cols, [['1'], ['2'], ['99999999']]),
      columns,
      rowData: makeRowData(['a'], [['1'], ['2'], ['99999999']]),
    });

    // ガードにより再計算されないため state identity が保持される
    expect(result.current.columnSizing).toBe(first);
  });

  it('columnsKey (name:type) が変わると再計算される', () => {
    const columnsA = makeColumns(['a']);
    const columnsB = makeColumns(['b']);
    const initial = {
      resultSet: makeResultSet([{ name: 'a', type: 'int' }], [['1']]),
      columns: columnsA,
      rowData: makeRowData(['a'], [['1']]),
    };

    const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
      initialProps: initial,
    });

    const first = result.current.columnSizing;
    expect(first.a).toBeGreaterThan(0);

    rerender({
      resultSet: makeResultSet([{ name: 'b', type: 'varchar' }], [['hello']]),
      columns: columnsB,
      rowData: makeRowData(['b'], [['hello']]),
    });

    expect(result.current.columnSizing.b).toBeGreaterThan(0);
    expect(result.current.columnSizing.a).toBeUndefined();
  });

  it('全行計測: 100行を超える rowData でも最終行の長いテキストが反映され maxWidth にクランプされる', () => {
    // 先頭100行は短い、101行目に長いテキストを置く。100行サンプリングだと見落とす。
    const cols = [{ name: 'a', type: 'varchar' }];
    const columns = makeColumns(['a']);
    const rows: string[][] = [];
    for (let i = 0; i < 100; i++) rows.push(['x']);
    rows.push(['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']); // 40文字
    const resultSet = makeResultSet(cols, rows);
    const rowData = makeRowData(['a'], rows);

    const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

    // setup.ts mock: 40文字 × 13 × 0.6 + padding 8 = 320 → varchar maxWidth 300 にクランプ
    // 正確値を確認することで (a) 全行計測、(b) maxWidth clamp の双方のミューテーションを検出
    expect(result.current.columnSizing.a).toBe(300);
  });

  it('minWidth clamp: 内容もヘッダーも極端に短くても minWidth を下回らない', () => {
    // varchar minWidth=50, padding=8 → 1文字 'x' は 7.8*1+8=15.8 で下回る
    const cols = [{ name: 'a', type: 'varchar' }];
    const columns = makeColumns(['a']);
    const resultSet = makeResultSet(cols, [['x']]);
    const rowData = makeRowData(['a'], [['x']]);

    const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

    // minWidth clamp が効かないと 15.8 になり本番でヘッダーが極端に狭くなる回帰
    expect(result.current.columnSizing.a).toBe(50);
  });

  it('triggerAutoSize: 同じ columnsKey でも強制再計算する', () => {
    const cols = [{ name: 'a', type: 'varchar' }];
    const columns = makeColumns(['a']);
    const initial = {
      resultSet: makeResultSet(cols, [['x']]),
      columns,
      rowData: makeRowData(['a'], [['x']]),
    };

    const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
      initialProps: initial,
    });

    const firstSizing = result.current.columnSizing;
    expect(firstSizing.a).toBeGreaterThan(0);

    // rowData に長いテキストを追加 (columnsKey は不変)
    rerender({
      resultSet: makeResultSet(cols, [['x'], ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']]),
      columns,
      rowData: makeRowData(['a'], [['x'], ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']]),
    });

    // 通常 rerender では再計算されない (既存テストで確認済)
    act(() => {
      result.current.triggerAutoSize();
    });

    // 強制再計算で幅が広がっていること
    expect(result.current.columnSizing.a).toBeGreaterThan(firstSizing.a);
  });

  it('triggerAutoSizeForColumn: 指定列のみ再計算、他列は保持', () => {
    const cols = [
      { name: 'a', type: 'varchar' },
      { name: 'b', type: 'varchar' },
    ];
    const columns = makeColumns(['a', 'b']);
    const initial = {
      resultSet: makeResultSet(cols, [['x', 'y']]),
      columns,
      rowData: makeRowData(['a', 'b'], [['x', 'y']]),
    };

    const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
      initialProps: initial,
    });

    const initialA = result.current.columnSizing.a;
    const initialB = result.current.columnSizing.b;
    expect(initialA).toBeGreaterThan(0);
    expect(initialB).toBeGreaterThan(0);

    // b にのみ長いテキスト追加
    rerender({
      resultSet: makeResultSet(cols, [
        ['x', 'y'],
        ['x', 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY'],
      ]),
      columns,
      rowData: makeRowData(
        ['a', 'b'],
        [
          ['x', 'y'],
          ['x', 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY'],
        ]
      ),
    });

    act(() => {
      result.current.triggerAutoSizeForColumn('b');
    });

    // b は再計算で広がっている、a は不変
    expect(result.current.columnSizing.b).toBeGreaterThan(initialB);
    expect(result.current.columnSizing.a).toBe(initialA);
  });
});
