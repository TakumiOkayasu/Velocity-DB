// ResultGrid のパラメタ chain 検証 integration テスト
//
// Harness 迂回ではなく ResultGrid 実 mount + 子コンポ/子 hook spy で
// 「useColumnAutoSize への入力」「triggerAutoSize/ForColumn の伝達先 identity」
// 「columnSizing prop の伝達」「rerender 跨ぎの rowData identity」を一発で検証する。
//
// 既存 `scrollPersistence.test.tsx` 方針 (Harness 迂回) からの意図的な逸脱:
// パラメタ chain のズレ (callback 参照入れ替え / prop 忘れ) は Harness 再現では
// 検出できないため、実 ResultGrid を mount して props 伝達を直接 capture する。

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ===== hoisted spy 群 (vi.mock factory から参照するため) =====
const spies = vi.hoisted(() => {
  const triggerAutoSize = { current: (() => {}) as () => void };
  const triggerAutoSizeForColumn = { current: (() => {}) as (id: string) => void };
  const columnSizing: Record<string, number> = {};
  const setColumnSizing = { current: ((_: unknown) => {}) as (u: unknown) => void };
  return {
    autoSizeArgs: { current: null as unknown },
    autoSizeCallCount: { current: 0 },
    toolbarProps: { current: null as Record<string, unknown> | null },
    gridTableProps: { current: null as Record<string, unknown> | null },
    keyboardArgs: { current: null as Record<string, unknown> | null },
    triggerAutoSize,
    triggerAutoSizeForColumn,
    columnSizing,
    setColumnSizing,
  };
});

// ===== store mock =====
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
  useScrollPositionStore: Object.assign((selector: (s: unknown) => unknown) => selector({}), {
    getState: () => ({
      savePosition: vi.fn(),
      getPosition: () => null,
    }),
  }),
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

// ===== useColumnAutoSize spy (最重要) =====
vi.mock('../../components/grid/hooks/useColumnAutoSize', () => ({
  useColumnAutoSize: (args: unknown) => {
    spies.autoSizeArgs.current = args;
    spies.autoSizeCallCount.current++;
    return {
      columnSizing: spies.columnSizing,
      setColumnSizing: spies.setColumnSizing.current,
      triggerAutoSize: spies.triggerAutoSize.current,
      triggerAutoSizeForColumn: spies.triggerAutoSizeForColumn.current,
    };
  },
}));

// ===== 子 component spy =====
vi.mock('../../components/grid/GridToolbar', () => ({
  GridToolbar: (props: Record<string, unknown>) => {
    spies.toolbarProps.current = props;
    return (
      <button
        data-testid="tb-autosize"
        type="button"
        onClick={() => (props.onAutoSizeColumns as () => void)?.()}
      >
        auto
      </button>
    );
  },
}));

vi.mock('../../components/grid/GridTable', () => ({
  GridTable: (props: Record<string, unknown>) => {
    spies.gridTableProps.current = props;
    return <div data-testid="grid-table" />;
  },
}));

vi.mock('../../components/grid/GridStatusBar', () => ({ GridStatusBar: () => null }));
vi.mock('../../components/grid/GridFilterBar', () => ({ GridFilterBar: () => null }));
vi.mock('../../components/grid/TransposeView', () => ({ TransposeView: () => null }));
vi.mock('../../components/grid/ResultTabs', () => ({ ResultTabs: () => null }));
vi.mock('../../components/grid/ValueEditorDialog', () => ({ ValueEditorDialog: () => null }));
vi.mock('../../components/dialogs/QueryConfirmDialog', () => ({ QueryConfirmDialog: () => null }));

// ===== 他 hook stub =====
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
    updateCell: () => {},
    revertChanges: () => {},
    deleteRow: () => {},
    cloneRow: () => {},
    insertRow: () => {},
    buildPreview: () => {},
    executePreview: () => {},
    dismissPreview: () => {},
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
  useGridKeyboard: (args: Record<string, unknown>) => {
    spies.keyboardArgs.current = args;
    return {
      editingCell: null,
      editValue: '',
      setEditValue: vi.fn(),
      startEdit: vi.fn(),
      commitEdit: vi.fn(),
    };
  },
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

vi.mock('../../components/grid/hooks/useClampedActiveIndex', () => ({
  useClampedActiveIndex: () => [0, vi.fn()],
}));

// ===== util mock =====
vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/lazyWithRetry', () => ({
  lazyWithRetry: () => () => null,
}));

// ===== import (mock 後) =====
import { ResultGrid } from '../../components/grid/ResultGrid';
import type { ResultSet } from '../../types';

const resultSetFixture: ResultSet = {
  columns: [
    { name: 'id', type: 'int', size: 0, nullable: false, isPrimaryKey: true },
    { name: 'name', type: 'varchar', size: 50, nullable: true, isPrimaryKey: false },
  ],
  rows: [
    ['1', 'alice'],
    ['2', 'bob'],
  ],
  affectedRows: 0,
  executionTimeMs: 0,
};

function resetSpies(): void {
  spies.autoSizeArgs.current = null;
  spies.autoSizeCallCount.current = 0;
  spies.toolbarProps.current = null;
  spies.gridTableProps.current = null;
  spies.keyboardArgs.current = null;
  spies.triggerAutoSize.current = vi.fn();
  spies.triggerAutoSizeForColumn.current = vi.fn();
  spies.setColumnSizing.current = vi.fn();
  // columnSizing は identity 比較したいので使い回す
  for (const k of Object.keys(spies.columnSizing)) delete spies.columnSizing[k];
}

describe('ResultGrid パラメタ chain (候補 a-d 一括検証)', () => {
  beforeEach(() => {
    storeState.current = {
      activeQueryId: 'q1',
      result: resultSetFixture,
      currentQuery: {
        id: 'q1',
        connectionId: null,
        sourceTable: null,
        whereClause: '',
      },
    };
    resetSpies();
  });

  afterEach(() => cleanup());

  it('useColumnAutoSize は { resultSet, columns, rowData } を shape 通り受け取る', () => {
    render(<ResultGrid queryId="q1" />);

    const args = spies.autoSizeArgs.current as {
      resultSet: ResultSet;
      columns: { id: string }[];
      rowData: Record<string, string | null>[];
    } | null;

    expect(args).not.toBeNull();
    expect(args?.resultSet).toBe(resultSetFixture);
    expect(args?.columns.map((c) => c.id)).toEqual(['id', 'name']);
    expect(args?.rowData).toHaveLength(2);
    expect(args?.rowData[0].id).toBe('1');
    expect(args?.rowData[0].name).toBe('alice');
  });

  it('GridToolbar.onAutoSizeColumns === triggerAutoSize (identity 一致)', () => {
    render(<ResultGrid queryId="q1" />);
    expect(spies.toolbarProps.current?.onAutoSizeColumns).toBe(spies.triggerAutoSize.current);
  });

  it('GridTable.onAutoSizeColumn === triggerAutoSizeForColumn', () => {
    render(<ResultGrid queryId="q1" />);
    expect(spies.gridTableProps.current?.onAutoSizeColumn).toBe(
      spies.triggerAutoSizeForColumn.current
    );
  });

  it('GridTable.onAutoSizeColumns === triggerAutoSize', () => {
    render(<ResultGrid queryId="q1" />);
    expect(spies.gridTableProps.current?.onAutoSizeColumns).toBe(spies.triggerAutoSize.current);
  });

  it('GridTable.columnSizing === useColumnAutoSize.columnSizing (identity 伝達)', () => {
    render(<ResultGrid queryId="q1" />);
    expect(spies.gridTableProps.current?.columnSizing).toBe(spies.columnSizing);
  });

  it('useGridKeyboard.onAutoSizeColumns === triggerAutoSize (Ctrl+Shift+A 経路)', () => {
    render(<ResultGrid queryId="q1" />);
    expect(spies.keyboardArgs.current?.onAutoSizeColumns).toBe(spies.triggerAutoSize.current);
  });

  it('toolbar click で triggerAutoSize が呼ばれる (4 経路のうち 1 つ: 末端到達)', () => {
    const trigger = vi.fn();
    spies.triggerAutoSize.current = trigger;
    const { getByTestId } = render(<ResultGrid queryId="q1" />);
    fireEvent.click(getByTestId('tb-autosize'));
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('rerender 跨ぎで rowData identity 安定 (getInsertedRows 空なら baseRowData 直返し)', () => {
    const { rerender } = render(<ResultGrid queryId="q1" />);
    const first = (spies.autoSizeArgs.current as { rowData: unknown[] }).rowData;
    rerender(<ResultGrid queryId="q1" />);
    const second = (spies.autoSizeArgs.current as { rowData: unknown[] }).rowData;
    expect(second).toBe(first);
  });

  it('rerender 跨ぎで columns identity 安定 (resultSet.columns 不変 + showLogicalNames 不変)', () => {
    const { rerender } = render(<ResultGrid queryId="q1" />);
    const first = (spies.autoSizeArgs.current as { columns: unknown[] }).columns;
    rerender(<ResultGrid queryId="q1" />);
    const second = (spies.autoSizeArgs.current as { columns: unknown[] }).columns;
    expect(second).toBe(first);
  });

  it('rerender 跨ぎで resultSet identity 安定 (store 同値)', () => {
    const { rerender } = render(<ResultGrid queryId="q1" />);
    const first = (spies.autoSizeArgs.current as { resultSet: unknown }).resultSet;
    rerender(<ResultGrid queryId="q1" />);
    const second = (spies.autoSizeArgs.current as { resultSet: unknown }).resultSet;
    expect(second).toBe(first);
  });
});
