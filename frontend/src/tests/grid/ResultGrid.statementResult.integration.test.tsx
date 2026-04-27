// ResultGrid → GridStatusBar の statementType chain を end-to-end で検証する
// integration テスト (#415)。
//
// 既存の単体テスト (sqlIdentifier.test.ts / GridStatusBar.test.tsx) では
// 以下のミューテーションが捕まらない:
//  - ResultGrid から `statementType={statementType}` prop を削除してもパスする
//  - useMemo の判定ブランチ (multipleResults vs single) を逆にしてもパスする
//  - currentQuery.content ではなく query.id を渡してもパスする (型は通ってしまう)
//
// 本テストは GridStatusBar を実体で mount し、queryStore に SQL + ResultSet を
// 流し込んで下ペインの表示テキストで振る舞いを検証する。
// 子 hook / 子 component は描画関心がないため最小スタブで切る。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('../../store/queryStore', () => ({
  useQueryStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(storeState.current),
    {
      getState: () => storeState.current,
      setState: (patch: Record<string, unknown>) => {
        storeState.current = { ...storeState.current, ...patch };
      },
      subscribe: () => () => {},
    }
  ),
  useIsActiveDataView: () => false,
  useIsQueryExecuting: () => false,
  useQueryResult: () => (storeState.current as { result?: unknown }).result ?? null,
  useQueryError: () => null,
  useQueryById: () => (storeState.current as { currentQuery?: unknown }).currentQuery ?? null,
  usePaginationState: () => null,
  useQueryActions: () => ({
    applyWhereFilter: vi.fn(),
    refreshDataView: vi.fn(),
    openTableData: vi.fn(),
    cancelQuery: vi.fn(),
    fetchMoreRows: vi.fn(),
    resetPaginatedSort: vi.fn(),
  }),
}));

vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: (selector: (s: { connections: unknown[] }) => unknown) =>
    selector({ connections: [] }),
}));

vi.mock('../../store/scrollPositionStore', () => ({
  useScrollPositionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({}),
    {
      getState: () => ({ savePosition: vi.fn(), getPosition: () => null }),
    }
  ),
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (
    selector: (s: {
      showLogicalNamesInGrid: boolean;
      setShowLogicalNamesInGrid: (v: boolean) => void;
    }) => unknown
  ) =>
    selector({
      showLogicalNamesInGrid: false,
      setShowLogicalNamesInGrid: vi.fn(),
    }),
}));

// 描画関心のない子は no-op で切る (GridStatusBar は実体)
vi.mock('../../components/grid/GridToolbar', () => ({ GridToolbar: () => null }));
vi.mock('../../components/grid/GridFilterBar', () => ({ GridFilterBar: () => null }));
vi.mock('../../components/grid/GridTable', () => ({ GridTable: () => null }));
vi.mock('../../components/grid/TransposeView', () => ({ TransposeView: () => null }));
vi.mock('../../components/grid/ValueEditorDialog', () => ({ ValueEditorDialog: () => null }));
vi.mock('../../components/dialogs/QueryConfirmDialog', () => ({
  QueryConfirmDialog: () => null,
}));

vi.mock('../../components/grid/hooks/useColumnAutoSize', () => ({
  useColumnAutoSize: () => ({
    columnSizing: {},
    setColumnSizing: vi.fn(),
    triggerAutoSize: vi.fn(),
    triggerAutoSizeForColumn: vi.fn(),
  }),
}));

const stableGetInsertedRows = vi.hoisted(() => {
  const empty = new Map<number, Record<string, string | null>>();
  return () => empty;
});

vi.mock('../../components/grid/hooks/useGridEdit', () => ({
  useGridEdit: () => ({
    isEditMode: false,
    hasChanges: false,
    isApplying: false,
    applyError: null,
    previewStatements: [],
    isRowDeleted: () => false,
    isRowInserted: () => false,
    getInsertedRows: stableGetInsertedRows,
    getCellChange: () => null,
    getValidationError: () => null,
    hasValidationErrors: false,
    updateCell: vi.fn(),
    revertChanges: vi.fn(),
    deleteRow: vi.fn(),
    cloneRow: vi.fn(),
    insertRow: vi.fn(),
    buildPreview: vi.fn(),
    executePreview: vi.fn(),
    dismissPreview: vi.fn(),
  }),
}));

vi.mock('../../components/grid/hooks/useGridSelection', () => ({
  useGridSelection: () => ({
    selectedRows: new Set<number>(),
    selectedColumns: new Set<string>(),
    selectionState: { selectedRows: new Set<number>(), selectedColumns: new Set<string>() },
    toggleRow: vi.fn(),
    rangeSelectRow: vi.fn(),
    selectCell: vi.fn(),
    rangeCellSelect: vi.fn(),
    selectColumn: vi.fn(),
    rangeSelectColumn: vi.fn(),
    selectAllRows: vi.fn(),
    resetSelection: vi.fn(),
  }),
}));

vi.mock('../../components/grid/hooks/useGridKeyboard', () => ({
  useGridKeyboard: () => ({
    editingCell: null,
    editValue: '',
    setEditValue: vi.fn(),
    startEdit: vi.fn(),
    commitEdit: vi.fn(),
  }),
}));

vi.mock('../../components/grid/hooks/useWhereFilter', () => ({
  useWhereFilter: () => ({
    whereClause: '',
    whereFilterError: null,
    setWhereFilterError: vi.fn(),
    whereKeyDown: vi.fn(),
    whereApply: vi.fn(),
    whereClear: vi.fn(),
    whereChange: vi.fn(),
  }),
}));

vi.mock('../../components/grid/hooks/useRelatedRows', () => ({
  useRelatedRows: () => ({
    isForeignKeyColumn: () => false,
    navigateToRelatedRow: vi.fn(),
  }),
}));

vi.mock('../../components/grid/hooks/useElapsedTimer', () => ({
  useElapsedTimer: () => 0,
}));

const activeIdx = vi.hoisted(() => ({ current: 0 }));
vi.mock('../../components/grid/hooks/useClampedActiveIndex', () => ({
  useClampedActiveIndex: () => [activeIdx.current, vi.fn()],
}));

vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/lazyWithRetry', () => ({
  lazyWithRetry: () => () => null,
}));

import { ResultGrid } from '../../components/grid/ResultGrid';
import type { ResultSet } from '../../types';

interface SetupOpts {
  sql: string;
  affectedRows: number;
  rows?: (string | null)[][];
  multipleResults?: Array<{ statement: string; affectedRows: number; rows?: (string | null)[][] }>;
}

function makeResultSet(rows: (string | null)[][], affectedRows: number): ResultSet {
  return { columns: [], rows, affectedRows, executionTimeMs: 1.0, truncated: false };
}

function setup(opts: SetupOpts): void {
  const result = opts.multipleResults
    ? {
        multipleResults: true,
        results: opts.multipleResults.map((r) => ({
          statement: r.statement,
          data: makeResultSet(r.rows ?? [], r.affectedRows),
        })),
      }
    : makeResultSet(opts.rows ?? [], opts.affectedRows);

  storeState.current = {
    activeQueryId: 'q1',
    currentQuery: { id: 'q1', content: opts.sql, connectionId: 'c1' },
    result,
    queries: [{ id: 'q1', content: opts.sql, connectionId: 'c1' }],
    paginationStates: {},
  };
}

afterEach(() => {
  cleanup();
  storeState.current = {};
  activeIdx.current = 0;
});

describe('ResultGrid → GridStatusBar: SQL 種別ごとの結果文言 (#415)', () => {
  it('UPDATE: 「N 件更新」を下ペインに表示する', () => {
    setup({ sql: 'UPDATE users SET active = 1 WHERE id = 5', affectedRows: 5 });
    render(<ResultGrid />);
    expect(screen.getByText('5 件更新')).toBeInTheDocument();
  });

  it('DELETE: WHERE で 0 件マッチでも「0 件削除」を表示する (issue #415 主因の 1 つ)', () => {
    setup({ sql: 'DELETE FROM users WHERE id = 9999', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.getByText('0 件削除')).toBeInTheDocument();
  });

  it('TRUNCATE: affectedRows=0 でも「テーブルを切り詰めました」を表示する (issue #415 直接の症状)', () => {
    setup({ sql: 'TRUNCATE TABLE logs', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.getByText('テーブルを切り詰めました')).toBeInTheDocument();
  });

  it('INSERT: 「N 件追加」を表示する', () => {
    setup({
      sql: 'INSERT INTO logs (msg) VALUES ($1), ($2), ($3)',
      affectedRows: 3,
    });
    render(<ResultGrid />);
    expect(screen.getByText('3 件追加')).toBeInTheDocument();
  });

  it('DROP: 件数を出さず「DROP を実行しました」を表示する', () => {
    setup({ sql: 'DROP TABLE old_logs', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.getByText('DROP を実行しました')).toBeInTheDocument();
  });

  it('CREATE: 「CREATE を実行しました」を表示する', () => {
    setup({ sql: 'CREATE TABLE t (id INT)', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.getByText('CREATE を実行しました')).toBeInTheDocument();
  });

  it('ALTER: 「ALTER を実行しました」を表示する', () => {
    setup({ sql: 'ALTER TABLE t ADD c INT', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.getByText('ALTER を実行しました')).toBeInTheDocument();
  });

  it('SELECT: 「件追加 / 件更新 / 件削除 / 切り詰め」のいずれも表示しない (回帰防止)', () => {
    setup({ sql: 'SELECT * FROM users', affectedRows: 0, rows: [['1'], ['2']] });
    render(<ResultGrid />);
    expect(screen.queryByText(/件追加|件更新|件削除|切り詰め/)).not.toBeInTheDocument();
  });

  it('WITH (CTE) → DELETE: 主動詞 DELETE を判定して「N 件削除」を表示する', () => {
    setup({
      sql: 'WITH cte AS (SELECT id FROM staging) DELETE FROM users WHERE id IN (SELECT id FROM cte)',
      affectedRows: 4,
    });
    render(<ResultGrid />);
    expect(screen.getByText('4 件削除')).toBeInTheDocument();
  });

  it('multipleResults: アクティブタブ (index 0) の statement で文言が決まる', () => {
    // 1 番目を UPDATE、2 番目を DELETE で渡し、index 0 (UPDATE) の文言が出ることを検証。
    // useClampedActiveIndex を [0, _] にスタブしているため index 0 がアクティブ。
    setup({
      sql: 'UPDATE a SET x=1; DELETE FROM b WHERE y=2;',
      affectedRows: 0,
      multipleResults: [
        { statement: 'UPDATE a SET x=1', affectedRows: 7 },
        { statement: 'DELETE FROM b WHERE y=2', affectedRows: 11 },
      ],
    });
    render(<ResultGrid />);
    expect(screen.getByText('7 件更新')).toBeInTheDocument();
    // 非アクティブタブの文言は出ないこと (multipleResults 経路の正しさ)
    expect(screen.queryByText('11 件削除')).not.toBeInTheDocument();
  });

  it('multipleResults: activeIndex を 1 に切り替えると 2 番目タブの statement で文言が決まる', () => {
    setup({
      sql: 'UPDATE a SET x=1; DELETE FROM b WHERE y=2;',
      affectedRows: 0,
      multipleResults: [
        { statement: 'UPDATE a SET x=1', affectedRows: 7 },
        { statement: 'DELETE FROM b WHERE y=2', affectedRows: 11 },
      ],
    });
    activeIdx.current = 1;
    render(<ResultGrid />);
    expect(screen.getByText('11 件削除')).toBeInTheDocument();
    expect(screen.queryByText('7 件更新')).not.toBeInTheDocument();
  });

  it('multipleResults: アクティブタブが TRUNCATE なら、件数表示なしで「テーブルを切り詰めました」', () => {
    setup({
      sql: 'TRUNCATE TABLE a; SELECT 1;',
      affectedRows: 0,
      multipleResults: [
        { statement: 'TRUNCATE TABLE a', affectedRows: 0 },
        { statement: 'SELECT 1', affectedRows: 0, rows: [['1']] },
      ],
    });
    render(<ResultGrid />);
    expect(screen.getByText('テーブルを切り詰めました')).toBeInTheDocument();
  });

  it('未知 verb (EXPLAIN) は OTHER fallback で affectedRows=0 だと文言を出さない', () => {
    setup({ sql: 'EXPLAIN SELECT * FROM t', affectedRows: 0 });
    render(<ResultGrid />);
    expect(screen.queryByText(/件追加|件更新|件削除|切り詰め|を実行しました/)).not.toBeInTheDocument();
  });
});
