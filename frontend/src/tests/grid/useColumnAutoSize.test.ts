import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { useColumnAutoSize } from '../../components/grid/hooks/useColumnAutoSize';
import type { ResultSet } from '../../types';
import type { RowData } from '../../types/grid';
import type { GridColumnDef } from '../../components/grid/tableFeatures';

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

function makeColumns(cols: string[]): GridColumnDef[] {
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

    // 実機 (fix/drag-lag-probe, 4/23 実機ログ) で発覚したリグレッション:
    // toolbar ボタン経由の全列 triggerAutoSize が async 進行中、ContextMenu 単列 trigger
    // (triggerAutoSizeForColumn) を呼ぶと、両者で共用する measurementIdRef が +1 され
    // 全列 async が shouldAbort() で中断、全列の setColumnSizing が永遠に呼ばれなかった。
    // 全列と単列は独立 axis のため互いに kill してはならない。
    it('全列 triggerAutoSize 進行中に triggerAutoSizeForColumn を呼んでも全列結果が反映される', async () => {
      const cols = [
        { name: 'a', type: 'varchar' },
        { name: 'b', type: 'varchar' },
      ];
      const columns = makeColumns(['a', 'b']);
      const rows: string[][] = [];
      for (let i = 0; i < ASYNC_ROW_COUNT; i++) {
        // 最終行だけ長い値を持たせる (全列 async が最後まで走らないと拾われない)
        rows.push(i === ASYNC_ROW_COUNT - 1 ? ['A'.repeat(30), 'B'.repeat(30)] : ['x', 'y']);
      }
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['a', 'b'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      // 初回 useLayoutEffect の全列 async 計測が進行中の状態で、単列 trigger を割り込ませる。
      // 不具合再現時: 単列 trigger が全列 token を +1 → 全列 async 中断 →
      //   columnSizing.b は永遠に未設定のまま (abort された全列結果の setState が skip されるため)。
      // 修正後: 全列 token と単列 token が分離 → 全列は自然に完走、単列は a だけ更新。
      act(() => {
        result.current.triggerAutoSizeForColumn('a');
      });

      // 全列計測の完走を待つ = b 列が長文 'B'.repeat(30) で計測され 200px 超になること
      await waitFor(
        () => {
          expect(result.current.columnSizing.b).toBeGreaterThan(200);
        },
        { timeout: 3000 }
      );
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

  // CSS .th/.td の左右 padding (12*2=24) + sort indicator (▲▼) 分 8 の合計 32 を
  // CELL_HORIZONTAL_PADDING として定数化した経緯 (ResultGrid.module.css 準拠)。
  // また numeric は桁で幅爆発せず、date は ISO8601 系で概ね固定長のため実幅尊重
  // (maxWidth=∞)、varchar/不明型は TEXT/JSON で暴発し得るため 300 の上限を維持する。
  describe('getColumnConfig (型別 minWidth/maxWidth/padding)', () => {
    it('varchar: width = max(header, content) + CELL_HORIZONTAL_PADDING(32)', () => {
      // header/content とも 4 文字: 4 × 14 × 0.6 = 33.6px, + padding 32 = 65.6。
      // FONT は `14px ${MONO_STACK}` (ResultGrid.module.css .table の font-size: 14px と一致)。
      // setup.ts mock: width = text.length * fontSize * 0.6 で 14px 時 33.6 を返す。
      // varchar [50, 300] の範囲内で clamp されないため padding 値が直接観測できる。
      // padding を 8 等に戻すと 33.6+8=41.6 が minWidth 50 に clamp され値が 50 になり検出。
      const cols = [{ name: 'abcd', type: 'varchar' }];
      const columns = makeColumns(['abcd']);
      const rows = [['abcd']];
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['abcd'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      expect(result.current.columnSizing.abcd).toBeCloseTo(33.6 + 32, 5);
    });

    it('numeric 列は maxWidth=Infinity で長い数値コンテンツがクランプされない', () => {
      // 200 桁 → 200 × 7.8 + 32 = 1592px。maxWidth=120 等に退行すると 120 に clamp され検出。
      const longNumber = '9'.repeat(200);
      const cols = [{ name: 'n', type: 'bigint' }];
      const columns = makeColumns(['n']);
      const rows = [[longNumber]];
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['n'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      // maxWidth 退行検出: 明らかに旧 120 を超える値が通ることを確認。
      expect(result.current.columnSizing.n).toBeGreaterThan(500);
    });

    it('date 列は maxWidth=Infinity で長いコンテンツがクランプされない', () => {
      // 100 文字 → 100 × 7.8 + 32 = 812px。maxWidth=180 等に退行すると 180 に clamp され検出。
      const longDate = 'A'.repeat(100);
      const cols = [{ name: 'd', type: 'datetime' }];
      const columns = makeColumns(['d']);
      const rows = [[longDate]];
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['d'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      expect(result.current.columnSizing.d).toBeGreaterThan(500);
    });

    it('varchar/不明型は maxWidth=300 で上限 clamp を維持 (TEXT/JSON 暴発防止)', () => {
      // 100 文字 → 812px だが varchar は上限 300 に clamp。
      // maxWidth を ∞ に変更する退行が起きると 812 が通ってしまう。
      const longText = 'A'.repeat(100);
      const cols = [{ name: 's', type: 'varchar' }];
      const columns = makeColumns(['s']);
      const rows = [[longText]];
      const resultSet = makeResultSet(cols, rows);
      const rowData = makeRowData(['s'], rows);

      const { result } = renderHook(() => useColumnAutoSize({ resultSet, columns, rowData }));

      expect(result.current.columnSizing.s).toBe(300);
    });
  });
});
