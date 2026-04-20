import type { ColumnDef } from '@tanstack/react-table';
import { renderHook } from '@testing-library/react';
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
});
