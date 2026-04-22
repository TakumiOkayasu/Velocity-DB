import type { ColumnDef } from '@tanstack/react-table';
import { act, renderHook, waitFor } from '@testing-library/react';
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

  // Issue #387 Phase 2: measureText 全行同期ループがメインスレッドを数十秒ブロック
  // する問題 (PROBE 計測で 25-52 秒ブロック確認) を解消するため、行数が閾値を超えた
  // 場合は chunk+yield で非同期計測する。計測中に rerender / 再 trigger が起きた
  // 場合、古い計測結果で上書きされないことを cancellation token で保証する。
  describe('async chunk measurement (大規模データ)', () => {
    const ASYNC_ROW_COUNT = 1200; // 閾値 (500) を超えて async path を踏ませる

    function makeLargeRowData(longestAt: number, longestText: string) {
      const rows: string[][] = [];
      for (let i = 0; i < ASYNC_ROW_COUNT; i++) {
        rows.push([i === longestAt ? longestText : 'x']);
      }
      return rows;
    }

    it('大量行の初回計測は非同期に反映される (同期では未計算、await 後に値)', async () => {
      const cols = [{ name: 'a', type: 'varchar' }];
      const columns = makeColumns(['a']);
      const rows = makeLargeRowData(ASYNC_ROW_COUNT - 1, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['a'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      // 同期直後は未反映 (初期値 {})。await 後に値が入ることを確認。
      expect(result.current.columnSizing.a).toBeUndefined();

      await waitFor(() => {
        expect(result.current.columnSizing.a).toBeGreaterThan(0);
      });

      // 末尾行の長いテキストが全行計測で拾われていること (sampling へのリグレッション防止)
      // 32 文字 × 13 × 0.6 + padding 8 = 257.6 → varchar maxWidth 300 には届かず 258
      expect(result.current.columnSizing.a).toBeGreaterThan(200);
    });

    // 旧テスト (columnsKey を a→b に差替) は cancellation token 削除ミュータントでも
    // PASS する偽陽性だったため、同一 columnsKey + rowData 差替 + 連続 trigger の構成に
    // 書き換えた。short の計測が後追いで long の結果を上書きしないことを値域で検証する。
    it('同一 columnsKey で連続 trigger した場合、古い計測結果が最新結果を上書きしない', async () => {
      const cols = [{ name: 'a', type: 'varchar' }];
      const columns = makeColumns(['a']);
      const shortRows = makeLargeRowData(-1, ''); // 全て 'x' → minWidth 50
      const longRows = makeLargeRowData(ASYNC_ROW_COUNT - 1, 'L'.repeat(30)); // 242px

      const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
        initialProps: {
          resultSet: makeResultSet(cols, shortRows),
          columns,
          rowData: makeRowData(['a'], shortRows),
        },
      });

      // 初回 async 計測 (short) の完了を待たずに rowData を long に差替 + 明示 trigger
      rerender({
        resultSet: makeResultSet(cols, longRows),
        columns,
        rowData: makeRowData(['a'], longRows),
      });
      act(() => {
        result.current.triggerAutoSize();
      });

      // 最終値は long 計測 (>200)。cancellation 無しだと short の計測完了が
      // 後追いで setColumnSizing({ a: 50 }) を呼び、最終値が 50 に落ちて FAIL する。
      await waitFor(() => {
        expect(result.current.columnSizing.a).toBeGreaterThan(200);
      });
      // 以降も short の結果に上書きされず、long 値で stable であること
      await act(() => new Promise<void>((r) => queueMicrotask(() => r())));
      expect(result.current.columnSizing.a).toBeGreaterThan(200);
    });

    // 旧テストは 2 回目も同じ long rowData での trigger だったため、cancellation が
    // 無効でも最終値が同じになり偽陽性だった。1 回目 (short) と 2 回目 (long) で
    // 計測対象を区別し、最終値が最新 trigger 由来の値域に収束することを検証する。
    it('連続 triggerAutoSize: 1 回目と異なる 2 回目の計測値が最終結果に反映される', async () => {
      const cols = [{ name: 'a', type: 'varchar' }];
      const columns = makeColumns(['a']);
      const shortRows = makeLargeRowData(-1, ''); // 全て 'x' → minWidth 50
      const longRows = makeLargeRowData(ASYNC_ROW_COUNT - 1, 'L'.repeat(30)); // 242px

      const { result, rerender } = renderHook((props) => useColumnAutoSize(props), {
        initialProps: {
          resultSet: makeResultSet(cols, shortRows),
          columns,
          rowData: makeRowData(['a'], shortRows),
        },
      });

      // 初回 (short) の async 計測を待たずに、1 回目の triggerAutoSize を発火
      // その直後に rowData を long に差替、2 回目の triggerAutoSize を発火
      act(() => {
        result.current.triggerAutoSize();
      });
      rerender({
        resultSet: makeResultSet(cols, longRows),
        columns,
        rowData: makeRowData(['a'], longRows),
      });
      act(() => {
        result.current.triggerAutoSize();
      });

      // 最終値は 2 回目 (long) の結果 > 200
      await waitFor(() => {
        expect(result.current.columnSizing.a).toBeGreaterThan(200);
      });
      // 追加マイクロタスクを流しても値が stable (short の結果で上書きされない)
      await act(() => new Promise<void>((r) => queueMicrotask(() => r())));
      expect(result.current.columnSizing.a).toBeGreaterThan(200);
    });

    // Issue #387: 超大規模データで SYNC_FULL_LIMIT (20000 行) 超過分は計測対象外とする。
    // この上限が撤廃されるとメインスレッドが長時間ブロックされる回帰となるため
    // 先頭 20000 行で clamping される既存動作を特性テストとして固定する。
    it('SYNC_FULL_LIMIT 超過: 20000 行目以降の長テキストは計測対象外', async () => {
      const SYNC_FULL_LIMIT = 20000;
      const cols = [{ name: 'a', type: 'varchar' }];
      const columns = makeColumns(['a']);
      const rows: string[][] = [];
      for (let i = 0; i < SYNC_FULL_LIMIT; i++) rows.push(['x']);
      rows.push(['A'.repeat(40)]); // 20001 行目: limit 外なので拾われない
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['a'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      await waitFor(
        () => {
          expect(result.current.columnSizing.a).toBeGreaterThan(0);
        },
        { timeout: 10000 }
      );

      // limit 超過行が拾われる実装に退行すると maxWidth 300 にクランプされる。
      // 現仕様では 'x' だけが対象 = padding 込 15.8 → minWidth 50 にクランプ。
      expect(result.current.columnSizing.a).toBe(50);
    });
  });
});
