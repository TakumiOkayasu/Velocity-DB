import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type Row,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  Suspense,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEphemeralOpen } from '../../hooks/useEphemeralOpen';
import { useConnectionStore } from '../../store/connectionStore';
import {
  useIsActiveDataView,
  useIsQueryExecuting,
  usePaginationState,
  useQueryActions,
  useQueryById,
  useQueryError,
  useQueryResult,
  useQueryStore,
} from '../../store/queryStore';
import { useScrollPositionStore } from '../../store/scrollPositionStore';
import { useSessionStore } from '../../store/sessionStore';
import type { ResultSet } from '../../types';
import { type ColumnMeta, type GridViewMode, isNumericType, type RowData } from '../../types/grid';
import { parseErrorMessage } from '../../utils/errorParser';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { log } from '../../utils/logger';
import { QueryConfirmDialog } from '../dialogs/QueryConfirmDialog';
import { GridFilterBar } from './GridFilterBar';
import { GridStatusBar } from './GridStatusBar';
import { GridTable } from './GridTable';
import { GridToolbar } from './GridToolbar';
import { useClampedActiveIndex } from './hooks/useClampedActiveIndex';
import { useColumnAutoSize } from './hooks/useColumnAutoSize';
import { useElapsedTimer } from './hooks/useElapsedTimer';
import { useGridEdit } from './hooks/useGridEdit';
import { useGridKeyboard } from './hooks/useGridKeyboard';
import { useGridSelection } from './hooks/useGridSelection';
import { useRelatedRows } from './hooks/useRelatedRows';
import { useWhereFilter } from './hooks/useWhereFilter';
import styles from './ResultGrid.module.css';
import { ResultTabs } from './ResultTabs';
import { TransposeView } from './TransposeView';
import { ValueEditorDialog } from './ValueEditorDialog';

const DmlPreviewDialog = lazyWithRetry(() =>
  import('../dialogs/DmlPreviewDialog').then((m) => ({ default: m.DmlPreviewDialog }))
);
const ErrorDetailDialog = lazyWithRetry(() =>
  import('../dialogs/ErrorDetailDialog').then((m) => ({ default: m.ErrorDetailDialog }))
);
const ExportDialog = lazyWithRetry(() =>
  import('../export/ExportDialog').then((m) => ({ default: m.ExportDialog }))
);

const ELAPSED_CAUTION_SECONDS = 10;
const ELAPSED_WARNING_SECONDS = 30;

// 'onEnd': drag 中は columnSizing state を更新せず、mouseup 時のみ反映。
// 'onChange' だと drag 中毎frame 全テーブル re-render で応答性が著しく悪化する。
// drag 中の視覚フィードバック (DataGrip風 overlay 縦線) は
// Phase 2 で columnSizingInfo.deltaOffset 経由で追加予定。
// export しているのは回帰防止テスト (ResultGrid.columnResizeMode.test.ts) で
// 値を直接検証するため (ソース文字列 match は fragile なため)。
export const COLUMN_RESIZE_MODE = 'onEnd' as const;

interface ResultGridProps {
  queryId?: string;
  excludeDataView?: boolean;
}

function ResultGridInner({ queryId, excludeDataView = false }: ResultGridProps = {}) {
  // --- Store subscriptions ---
  const activeQueryId = useQueryStore((state) => state.activeQueryId);
  const isActiveDataView = useIsActiveDataView();
  const targetQueryId = excludeDataView && isActiveDataView ? null : (queryId ?? activeQueryId);
  const currentQuery = useQueryById(targetQueryId);
  const queryConnectionId = currentQuery?.connectionId ?? null;
  const activeConn = useConnectionStore(
    (state) => state.connections.find((c) => c.id === queryConnectionId) ?? null
  );
  const isReadOnly = activeConn?.isReadOnly ?? false;
  const queryResult = useQueryResult(targetQueryId);
  const isExecuting = useIsQueryExecuting(targetQueryId);
  const error = useQueryError(targetQueryId);
  const showLogicalNamesInGrid = useSessionStore((state) => state.showLogicalNamesInGrid);
  const setShowLogicalNamesInGrid = useSessionStore((state) => state.setShowLogicalNamesInGrid);
  const pagination = usePaginationState(targetQueryId);
  const {
    applyWhereFilter,
    refreshDataView,
    openTableData,
    cancelQuery,
    fetchMoreRows,
    resetPaginatedSort,
  } = useQueryActions();

  // --- Local state ---
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const rowsLengthRef = useRef(0);
  const columnOrderRef = useRef<string[]>([]);
  const viewRowsRef = useRef<Row<RowData>[]>([]);
  const [valueEditorState, setValueEditorState] = useState<{
    isOpen: boolean;
    rowIndex: number;
    columnName: string;
    value: string | null;
  }>({ isOpen: false, rowIndex: 0, columnName: '', value: null });
  const [viewMode, setViewMode] = useState<GridViewMode>('table');
  const [transposeRowIndex, setTransposeRowIndex] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  // エラーダイアログの表示制御: error 到来で自動 open、ユーザーが閉じられる、再 open 可
  const {
    isOpen: isErrorDialogOpen,
    dismiss: dismissErrorDialog,
    reopen: reopenErrorDialog,
  } = useEphemeralOpen(error);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const elapsedSeconds = useElapsedTimer(isExecuting);

  const {
    selectedRows,
    selectedColumns,
    selectionState: gridSelectionState,
    toggleRow,
    rangeSelectRow,
    selectCell,
    rangeCellSelect,
    selectColumn,
    rangeSelectColumn,
    selectAllRows,
    resetSelection,
  } = useGridSelection(rowsLengthRef, columnOrderRef);

  const {
    whereClause,
    whereFilterError,
    setWhereFilterError,
    whereKeyDown,
    whereApply,
    whereClear,
    whereChange,
  } = useWhereFilter({
    activeQueryId: targetQueryId,
    queryConnectionId,
    storedWhereClause: currentQuery?.whereClause ?? '',
    applyWhereFilter,
  });

  // --- Derived data ---
  const isMultiple =
    queryResult !== null && queryResult !== undefined && 'multipleResults' in queryResult;
  const multipleResult = isMultiple ? queryResult : null;
  const filteredResults = multipleResult
    ? multipleResult.results.filter((r) => !r.statement.trim().toUpperCase().startsWith('USE '))
    : null;
  const hasFilteredResults = filteredResults && filteredResults.length > 0;
  const singleResult: ResultSet | null = !isMultiple && queryResult ? queryResult : null;
  const [activeResultIndex, setActiveResultIndex] = useClampedActiveIndex(
    filteredResults?.length ?? 0
  );
  const resultSet: ResultSet | null = hasFilteredResults
    ? (filteredResults[activeResultIndex]?.data ?? null)
    : singleResult;

  // --- Row / Column data ---
  const baseRowData = useMemo<RowData[]>(() => {
    if (!resultSet) return [];
    const rows = resultSet.rows;
    const cols = resultSet.columns;
    const result = new Array(rows.length);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const obj: Record<string, string | null> = {
        __rowIndex: String(rowIndex + 1),
        __originalIndex: String(rowIndex),
      };
      for (let colIdx = 0; colIdx < cols.length; colIdx++) {
        const value = row[colIdx];
        obj[cols[colIdx].name] = value ?? null;
      }
      result[rowIndex] = obj;
    }
    return result;
  }, [resultSet]);

  // データ変更時にtransposeRowIndexをクランプ
  useEffect(() => {
    setTransposeRowIndex((prev) => {
      if (baseRowData.length === 0) return 0;
      return Math.min(prev, baseRowData.length - 1);
    });
  }, [baseRowData]);

  // dep は resultSet.columns に絞る: fetchMoreRows で resultSet identity が変わっても
  // columns プロパティは `...currentResult` で維持されるため再生成不要。
  // resultSet 全体を dep にすると columnDef が毎回新規生成され、TanStack Table の
  // columnSizing との紐付けがスクロールのたびに揺らぎ、列幅変動に繋がる (#368)。
  const resultSetColumns = resultSet?.columns;
  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!resultSetColumns) return [];
    return resultSetColumns.map((col) => {
      const isNumeric = isNumericType(col.type);
      const displayName = showLogicalNamesInGrid && col.comment ? col.comment : col.name;
      return {
        id: col.name,
        header: displayName,
        accessorKey: col.name,
        size: 150,
        minSize: 80,
        meta: { type: col.type, align: isNumeric ? 'right' : 'left' },
      };
    });
  }, [resultSetColumns, showLogicalNamesInGrid]);

  const columnsMeta = useMemo<ColumnMeta[]>(() => {
    if (!resultSetColumns) return [];
    return resultSetColumns.map((col) => ({
      name: col.name,
      comment: col.comment ?? '',
      type: col.type,
    }));
  }, [resultSetColumns]);

  // --- Hooks ---
  const {
    isEditMode,
    hasChanges,
    isApplying,
    applyError,
    previewStatements,
    isRowDeleted,
    isRowInserted,
    getInsertedRows,
    getCellChange,
    getValidationError,
    hasValidationErrors,
    updateCell,
    revertChanges,
    deleteRow,
    cloneRow,
    insertRow,
    buildPreview,
    executePreview,
    dismissPreview,
  } = useGridEdit({
    resultSet,
    currentQuery,
    activeConnectionId: queryConnectionId,
    rowData: baseRowData,
    selectedRows,
    isReadOnly,
  });

  const rowData = useMemo<RowData[]>(() => {
    const insertedRows = getInsertedRows();
    if (insertedRows.size === 0) return baseRowData;
    const combined = [...baseRowData];
    insertedRows.forEach((rowValues, rowIndex) => {
      combined.push({ ...rowValues, __rowIndex: '新規', __originalIndex: String(rowIndex) });
    });
    return combined;
  }, [baseRowData, getInsertedRows]);

  // 列幅オートアジャスト (Issue #387):
  // - 初回 (columnsKey 変化時) のみ自動で全行の MAX 幅に合わせる (#368 flash 回避)
  // - ユーザー drag resize は維持 (triggerAutoSize/ForColumn で明示再計算も可)
  // - 500行超は measureText を chunk+yield で非同期化 (メインスレッドブロック回避)
  const { columnSizing, setColumnSizing, triggerAutoSize, triggerAutoSizeForColumn } =
    useColumnAutoSize({ resultSet, columns, rowData });

  const openRelatedTable = useCallback(
    (tableName: string, fkWhereClause: string) => {
      if (queryConnectionId) openTableData(queryConnectionId, tableName, fkWhereClause);
    },
    [queryConnectionId, openTableData]
  );

  const { isForeignKeyColumn, navigateToRelatedRow } = useRelatedRows({
    connectionId: queryConnectionId,
    tableName: currentQuery?.sourceTable ?? null,
    onOpenRelatedTable: openRelatedTable,
  });

  const navigateRelated = useCallback(
    (rowIndex: number, columnName: string) => {
      const row = rowData[rowIndex];
      if (row) navigateToRelatedRow(columnName, row);
    },
    [rowData, navigateToRelatedRow]
  );

  const openValueEditor = useCallback(
    (rowIndex: number, columnName: string, currentValue: string | null) => {
      setValueEditorState({ isOpen: true, rowIndex, columnName, value: currentValue });
    },
    []
  );

  const saveValueEditor = useCallback(
    (newValue: string | null) => {
      const { rowIndex, columnName, value: oldValue } = valueEditorState;
      if (oldValue !== newValue) updateCell(rowIndex, columnName, oldValue, newValue);
      setValueEditorState((prev) => ({ ...prev, isOpen: false }));
    },
    [valueEditorState, updateCell]
  );

  const getRowByViewIndex = useCallback(
    (viewIndex: number): RowData | undefined => viewRowsRef.current[viewIndex]?.original,
    []
  );

  const { editingCell, editValue, setEditValue, startEdit, commitEdit } = useGridKeyboard({
    isEditMode,
    selectedRows,
    selectedColumns,
    columns,
    rowData,
    getRowByViewIndex,
    tableContainerRef,
    updateCell,
    onDeleteRow: deleteRow,
    onCloneRow: cloneRow,
    onInsertRow: insertRow,
    onApplyChanges: buildPreview,
    onNavigateRelated: navigateRelated,
    onOpenValueEditor: openValueEditor,
    onSelectAll: selectAllRows,
    onAutoSizeColumns: triggerAutoSize,
  });

  const isPaginated = !!pagination;

  const sortingChangeHandler = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      setSorting((prev) => {
        const newSorting = typeof updater === 'function' ? updater(prev) : updater;
        if (isPaginated && targetQueryId) {
          const sortModel = newSorting.map((s) => ({
            colId: s.id,
            sort: (s.desc ? 'desc' : 'asc') as 'asc' | 'desc',
          }));
          resetPaginatedSort(targetQueryId, sortModel);
        }
        return newSorting;
      });
    },
    [isPaginated, targetQueryId, resetPaginatedSort]
  );

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    // 自前 resize 実装 (ColumnResizer 内 overlay indicator) のため TanStack 内蔵 resize は無効化。
    // `header.column.getCanResize()` 判定維持のため `enableColumnResizing: true`、
    // ただし columnResizeMode は drag 中の TanStack 内 state 更新を抑止するため未指定 (default 'onEnd')。
    enableColumnResizing: true,
    enableSorting: true,
    enableColumnFilters: true,
    manualSorting: isPaginated,
    columnResizeMode: COLUMN_RESIZE_MODE,
    state: { columnSizing, sorting, columnFilters },
    onColumnSizingChange: setColumnSizing,
    onSortingChange: sortingChangeHandler,
    onColumnFiltersChange: setColumnFilters,
  });

  const { rows } = table.getRowModel();
  rowsLengthRef.current = rows.length;
  columnOrderRef.current = table.getAllLeafColumns().map((c) => c.id);
  viewRowsRef.current = rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 10,
    // WebView2 software compositing delays flex layout resolution,
    // causing the container's clientHeight to be 0 on first measure.
    // Provide a non-zero fallback so calculateRange returns items
    // instead of null while ResizeObserver catches up.
    initialRect: { width: 0, height: window.innerHeight },
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;

  // --- Force virtualizer re-measure when container size changes ---
  // WebView2 software compositing may delay layout; the built-in
  // ResizeObserver inside @tanstack/react-virtual can miss the first
  // resize if it fires before the element is observed.
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      rowVirtualizer.measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowVirtualizer]);

  // --- Preserve scroll position per query when switching tabs ---
  // UI state (sort/filter/selection) は per-tab 独立のためリセット維持。
  // スクロール位置のみ前 queryId 単位で保存→復元 (Issue #366)。
  const prevQueryIdRef = useRef<string | null>(null);
  const scrollRestoredForQueryRef = useRef<string | null>(null);
  // タブ切替の過渡期 (queryId 変化 → E2 復元完了まで) に発火する scroll event を
  // ユーザー操作として扱わないための抑止フラグ。スクロール復元の programmatic scroll や
  // DOM height 変化による clamp-scroll が store[newQueryId] に旧値を書き込むのを防ぐ。
  const suppressScrollSaveRef = useRef(false);

  // 1. タブ切替時: UI reset + scroll save 抑止 ON (scroll 保存は onScroll で常時実施)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally triggered by targetQueryId change
  useEffect(() => {
    // 過渡期に発火する scroll event が新 queryId の store を汚染するのを防ぐ。
    // E2 復元完了または rows 未到達で成立し得ない場合の timeout でクリア。
    suppressScrollSaveRef.current = true;
    resetSelection();
    setSorting([]);
    setColumnFilters([]);
    setShowColumnFilters(false);
    setActiveResultIndex(0);
    prevQueryIdRef.current = targetQueryId;
    scrollRestoredForQueryRef.current = null;
  }, [targetQueryId]);

  // Scroll 位置を onScroll で常時保存 (closure で現在の targetQueryId に紐付け)。
  // useEffect での保存は ref=null or 誤 queryId 問題を起こすため廃止。
  // 復元中の programmatic scroll は scrollRestoredForQueryRef で識別し保存を抑止する必要はない
  // (同値を保存するだけで害なし)。
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!targetQueryId) return;
      if (suppressScrollSaveRef.current) return;
      const el = e.currentTarget;
      useScrollPositionStore
        .getState()
        .savePosition(targetQueryId, { top: el.scrollTop, left: el.scrollLeft });
    },
    [targetQueryId]
  );

  // 2. スクロール位置復元: rows が描画可能になり container が実サイズを持った後に 1 回だけ実施。
  // WebView2 の flex layout 解決遅延で clientHeight が 0 のままになる可能性があるため、
  // rAF ループでリトライ。clamp を避けるため scrollToOffset は totalSize 確定後に実行する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll restore is a one-shot per queryId
  useEffect(() => {
    if (!targetQueryId) return;
    if (scrollRestoredForQueryRef.current === targetQueryId) return;
    if (rows.length === 0) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    const tryRestore = () => {
      if (cancelled) return;
      if (scrollRestoredForQueryRef.current === targetQueryId) return;

      const el = tableContainerRef.current;
      if (!el || el.clientHeight === 0) {
        if (attempts++ < MAX_ATTEMPTS) {
          requestAnimationFrame(tryRestore);
        } else {
          // 限界超過 — 復元諦めて抑止解除 (user scroll 保存を許可)
          suppressScrollSaveRef.current = false;
        }
        return;
      }

      rowVirtualizer.measure();
      const totalSize = rowVirtualizer.getTotalSize();
      if (totalSize === 0) {
        if (attempts++ < MAX_ATTEMPTS) {
          requestAnimationFrame(tryRestore);
        } else {
          suppressScrollSaveRef.current = false;
        }
        return;
      }

      const saved = useScrollPositionStore.getState().getPosition(targetQueryId);
      if (saved) {
        rowVirtualizer.scrollToOffset(saved.top);
        el.scrollLeft = saved.left;
      }
      scrollRestoredForQueryRef.current = targetQueryId;
      // 復元 programmatic scroll 完了後に抑止解除。scroll event は同期発火または
      // 次 microtask で発火するため rAF 2 回待ち (1 回目: event 発火、2 回目: 解除)。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          suppressScrollSaveRef.current = false;
        });
      });
    };

    requestAnimationFrame(tryRestore);
    return () => {
      cancelled = true;
    };
  }, [targetQueryId, rows.length]);

  // --- Save scroll position on unmount (tab switched to non-grid view) ---
  useEffect(() => {
    return () => {
      const el = tableContainerRef.current;
      const qid = prevQueryIdRef.current;
      if (qid && el) {
        useScrollPositionStore
          .getState()
          .savePosition(qid, { top: el.scrollTop, left: el.scrollLeft });
      }
    };
  }, []);

  // --- Infinite scroll: fetch more rows when nearing bottom ---
  useEffect(() => {
    if (!targetQueryId || lastVirtualIndex < 0 || rows.length === 0) return;
    if (lastVirtualIndex / rows.length <= 0.8) return;
    const pag = useQueryStore.getState().paginationStates[targetQueryId];
    if (!pag?.hasMore || pag.isLoadingMore) return;
    fetchMoreRows(targetQueryId);
  }, [lastVirtualIndex, rows.length, targetQueryId, fetchMoreRows]);

  // --- Stable props for GridTable (avoid memo breakage) ---
  const gridEditState = useMemo(
    () => ({
      isEditMode,
      editingCell,
      editValue,
      isRowDeleted,
      isRowInserted,
      getCellChange,
      getValidationError,
      isForeignKeyColumn,
    }),
    [
      isEditMode,
      editingCell,
      editValue,
      isRowDeleted,
      isRowInserted,
      getCellChange,
      getValidationError,
      isForeignKeyColumn,
    ]
  );

  // --- Callbacks for sub-components ---
  const gridCallbacks = useMemo(
    () => ({
      onSetEditValue: setEditValue,
      onStartEdit: startEdit,
      onCommitEdit: commitEdit,
      onRowToggle: toggleRow,
      onRowRangeSelect: rangeSelectRow,
      onCellClick: selectCell,
      onCellRangeSelect: rangeCellSelect,
      onColumnSelect: selectColumn,
      onColumnRangeSelect: rangeSelectColumn,
      onUpdateCell: updateCell,
    }),
    [
      setEditValue,
      startEdit,
      commitEdit,
      toggleRow,
      rangeSelectRow,
      selectCell,
      rangeCellSelect,
      selectColumn,
      rangeSelectColumn,
      updateCell,
    ]
  );

  const cancelCurrentQuery = useCallback(() => {
    if (queryConnectionId) cancelQuery(queryConnectionId);
  }, [queryConnectionId, cancelQuery]);

  const refresh = useCallback(() => {
    if (targetQueryId && queryConnectionId) {
      refreshDataView(targetQueryId, queryConnectionId);
    }
  }, [targetQueryId, queryConnectionId, refreshDataView]);

  const toggleColumnFilters = useCallback(() => {
    setShowColumnFilters((prev) => {
      if (prev) setColumnFilters([]);
      return !prev;
    });
  }, []);

  const openExportDialog = useCallback(() => setIsExportDialogOpen(true), []);

  const changeViewMode = useCallback(
    (mode: GridViewMode) => {
      if (mode === 'transpose' && selectedRows.size > 0) {
        setTransposeRowIndex(Math.min(...selectedRows));
      }
      setViewMode(mode);
    },
    [selectedRows]
  );

  // --- Early returns ---
  if (isExecuting) {
    const isWarning = elapsedSeconds >= ELAPSED_WARNING_SECONDS;
    const isCaution = elapsedSeconds >= ELAPSED_CAUTION_SECONDS;
    const elapsedClass = isWarning
      ? styles.elapsedWarning
      : isCaution
        ? styles.elapsedCaution
        : styles.elapsedTime;
    const progressClass = isWarning
      ? `${styles.progressBar} ${styles.progressWarning}`
      : isCaution
        ? `${styles.progressBar} ${styles.progressCaution}`
        : styles.progressBar;
    return (
      <div className={styles.message}>
        {activeConn && (
          <span className={styles.connectionInfo}>
            {activeConn.server}/{activeConn.database}
          </span>
        )}
        <div className={styles.messageRow}>
          <span className={styles.spinner}>{'\u23F3'}</span>
          <span>クエリ実行中...</span>
          <span className={elapsedClass}>{elapsedSeconds}s</span>
        </div>
        {isWarning && (
          <span className={styles.longRunningHint}>
            長時間実行中 - 必要に応じてキャンセルしてください
          </span>
        )}
        <div className={progressClass} />
        {queryConnectionId && (
          <button onClick={cancelCurrentQuery} className={styles.cancelButton}>
            キャンセル
          </button>
        )}
      </div>
    );
  }

  if (error) {
    log.debug(`[ResultGrid] Showing error: ${error}`);
    const parsed = parseErrorMessage(error);
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>{parsed.summary}</span>
        <button className={styles.errorDetailButton} onClick={reopenErrorDialog}>
          詳細を表示
        </button>
        <Suspense fallback={null}>
          <ErrorDetailDialog
            isOpen={isErrorDialogOpen}
            errorMessage={error}
            onClose={dismissErrorDialog}
          />
        </Suspense>
      </div>
    );
  }

  if (!resultSet) {
    return (
      <div className={styles.message}>
        <span className={styles.emptyIcon}>{'\u{1F50D}'}</span>
        <span>クエリを実行して結果を表示</span>
        <div className={styles.shortcutList}>
          <span className={styles.shortcutItem}>
            <kbd>F9</kbd> SQLを実行
          </span>
          <span className={styles.shortcutItem}>
            <kbd>Ctrl+N</kbd> 新規タブ
          </span>
          <span className={styles.shortcutItem}>
            <kbd>Ctrl+S</kbd> 変更を保存
          </span>
          <span className={styles.shortcutItem}>
            <kbd>F5</kbd> データ再取得
          </span>
        </div>
      </div>
    );
  }

  // --- Render ---
  return (
    <div className={styles.container}>
      {hasFilteredResults && (
        <ResultTabs
          results={filteredResults}
          activeIndex={activeResultIndex}
          onSelect={setActiveResultIndex}
        />
      )}

      <GridToolbar
        showRefresh={!!currentQuery?.sourceTable && !!queryConnectionId}
        canEdit={!!currentQuery?.sourceTable}
        hasChanges={hasChanges}
        isApplying={isApplying}
        applyError={applyError}
        hasValidationErrors={hasValidationErrors}
        showLogicalNamesInGrid={showLogicalNamesInGrid}
        showColumnFilters={showColumnFilters}
        isReadOnly={isReadOnly}
        viewMode={viewMode}
        onRefresh={refresh}
        onInsertRow={insertRow}
        onDeleteRow={deleteRow}
        onRevertChanges={revertChanges}
        onApplyChanges={buildPreview}
        onSetShowLogicalNames={setShowLogicalNamesInGrid}
        onToggleColumnFilters={toggleColumnFilters}
        onExport={openExportDialog}
        onAutoSizeColumns={triggerAutoSize}
        onChangeViewMode={changeViewMode}
      />

      {currentQuery?.sourceTable && (
        <GridFilterBar
          whereClause={whereClause}
          isExecuting={isExecuting}
          onWhereChange={whereChange}
          onApply={whereApply}
          onClear={whereClear}
          onKeyDown={whereKeyDown}
        />
      )}

      {viewMode === 'table' ? (
        <GridTable
          table={table}
          tableContainerRef={tableContainerRef}
          rows={rows}
          virtualRows={virtualRows}
          totalSize={virtualTotalSize}
          showColumnFilters={showColumnFilters}
          showLogicalNamesInGrid={showLogicalNamesInGrid}
          columnsMeta={columnsMeta}
          edit={gridEditState}
          selection={gridSelectionState}
          callbacks={gridCallbacks}
          tableName={currentQuery?.sourceTable}
          onScroll={handleScroll}
          onAutoSizeColumn={triggerAutoSizeForColumn}
          onAutoSizeColumns={triggerAutoSize}
          columnSizing={columnSizing}
        />
      ) : (
        <TransposeView
          columns={columnsMeta}
          rowData={baseRowData}
          currentRowIndex={transposeRowIndex}
          showLogicalNames={showLogicalNamesInGrid}
          onNavigate={setTransposeRowIndex}
        />
      )}

      <GridStatusBar
        resultSet={resultSet}
        filteredRowCount={rows.length}
        isFiltered={columnFilters.length > 0}
        isReadOnly={isReadOnly}
        connectionLabel={activeConn ? `${activeConn.server}/${activeConn.database}` : undefined}
        viewMode={viewMode}
        transposeRowIndex={transposeRowIndex}
        pagination={pagination}
      />

      <Suspense fallback={null}>
        <ExportDialog
          isOpen={isExportDialogOpen}
          onClose={() => setIsExportDialogOpen(false)}
          resultSet={resultSet}
        />
      </Suspense>

      <ValueEditorDialog
        isOpen={valueEditorState.isOpen}
        columnName={valueEditorState.columnName}
        initialValue={valueEditorState.value}
        onSave={saveValueEditor}
        onCancel={() => setValueEditorState((prev) => ({ ...prev, isOpen: false }))}
      />

      <Suspense fallback={null}>
        <DmlPreviewDialog
          isOpen={previewStatements.length > 0}
          statements={previewStatements}
          isExecuting={isApplying}
          onExecute={executePreview}
          onCancel={dismissPreview}
        />
      </Suspense>

      <QueryConfirmDialog
        isOpen={whereFilterError !== null}
        title="WHEREフィルタエラー"
        message="フィルタの適用中にエラーが発生しました。WHERE句を確認してください。"
        details={whereFilterError ?? undefined}
        confirmLabel="OK"
        cancelLabel="閉じる"
        onConfirm={() => setWhereFilterError(null)}
        onCancel={() => setWhereFilterError(null)}
      />
    </div>
  );
}

export const ResultGrid = memo(ResultGridInner);
