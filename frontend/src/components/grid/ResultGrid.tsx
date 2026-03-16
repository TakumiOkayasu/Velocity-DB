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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import {
  useIsActiveDataView,
  useIsQueryExecuting,
  useQueryActions,
  useQueryById,
  useQueryError,
  useQueryResult,
  useQueryStore,
} from '../../store/queryStore';
import { useSessionStore } from '../../store/sessionStore';
import type { ResultSet } from '../../types';
import {
  type ColumnMeta,
  type GridViewMode,
  isNumericType,
  isSystemColumn,
  type RowData,
} from '../../types/grid';
import { parseErrorMessage } from '../../utils/errorParser';
import { log } from '../../utils/logger';
import { DmlPreviewDialog } from '../dialogs/DmlPreviewDialog';
import { ErrorDetailDialog } from '../dialogs/ErrorDetailDialog';
import { QueryConfirmDialog } from '../dialogs/QueryConfirmDialog';
import { ExportDialog } from '../export/ExportDialog';
import { GridFilterBar } from './GridFilterBar';
import { GridStatusBar } from './GridStatusBar';
import { GridTable } from './GridTable';
import { GridToolbar } from './GridToolbar';
import { useColumnAutoSize } from './hooks/useColumnAutoSize';
import { useElapsedTimer } from './hooks/useElapsedTimer';
import { useGridEdit } from './hooks/useGridEdit';
import { useGridKeyboard } from './hooks/useGridKeyboard';
import { useRelatedRows } from './hooks/useRelatedRows';
import styles from './ResultGrid.module.css';
import { ResultTabs } from './ResultTabs';
import { TransposeView } from './TransposeView';
import { ValueEditorDialog } from './ValueEditorDialog';

const ELAPSED_CAUTION_SECONDS = 10;
const ELAPSED_WARNING_SECONDS = 30;

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
  const { applyWhereFilter, refreshDataView, openTableData, cancelQuery } = useQueryActions();

  // --- Local state ---
  const [whereClause, setWhereClause] = useState('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const lastClickedRowRef = useRef<number | null>(null);
  const lastClickedColumnRef = useRef<string | null>(null);
  const rowsLengthRef = useRef(0);
  const columnOrderRef = useRef<string[]>([]);
  const viewRowsRef = useRef<Row<RowData>[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
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
  const [whereFilterError, setWhereFilterError] = useState<string | null>(null);
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const elapsedSeconds = useElapsedTimer(isExecuting);

  useEffect(() => {
    setIsErrorDialogOpen(!!error);
  }, [error]);

  // --- Derived data ---
  const multipleResult = queryResult && 'multipleResults' in queryResult ? queryResult : null;
  const filteredResults = multipleResult
    ? multipleResult.results.filter((r) => !r.statement.trim().toUpperCase().startsWith('USE '))
    : null;
  const hasFilteredResults = filteredResults && filteredResults.length > 0;
  const resultSet: ResultSet | null = hasFilteredResults
    ? (filteredResults[activeResultIndex]?.data ?? null)
    : multipleResult
      ? null
      : (queryResult as ResultSet | null);

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

  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!resultSet) return [];
    return resultSet.columns.map((col) => {
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
  }, [resultSet, showLogicalNamesInGrid]);

  const columnsMeta = useMemo<ColumnMeta[]>(() => {
    if (!resultSet) return [];
    return resultSet.columns.map((col) => ({
      name: col.name,
      comment: col.comment ?? '',
      type: col.type,
    }));
  }, [resultSet]);

  // --- Hooks ---
  const { columnSizing, setColumnSizing } = useColumnAutoSize({
    resultSet,
    columns,
    rowData: baseRowData,
  });

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
  });

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    enableColumnResizing: true,
    enableSorting: true,
    enableColumnFilters: true,
    columnResizeMode: 'onChange',
    state: { columnSizing, sorting, columnFilters },
    onColumnSizingChange: setColumnSizing,
    onSortingChange: setSorting,
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
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  // --- Stable props for GridTable (avoid memo breakage) ---
  const gridEditState = useMemo(
    () => ({
      isEditMode,
      editingCell,
      editValue,
      isRowDeleted,
      isRowInserted,
      getCellChange,
      isForeignKeyColumn,
    }),
    [
      isEditMode,
      editingCell,
      editValue,
      isRowDeleted,
      isRowInserted,
      getCellChange,
      isForeignKeyColumn,
    ]
  );

  const gridSelectionState = useMemo(
    () => ({ selectedRows, selectedColumns }),
    [selectedRows, selectedColumns]
  );

  // --- Callbacks for sub-components ---
  const toggleRow = useCallback((rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
    lastClickedRowRef.current = rowIndex;
    setSelectedColumns(new Set());
  }, []);

  const rangeSelectRow = useCallback((rowIndex: number) => {
    if (lastClickedRowRef.current === null) return;
    const start = Math.min(lastClickedRowRef.current, rowIndex);
    const end = Math.max(lastClickedRowRef.current, rowIndex);
    const range = new Set<number>();
    for (let i = start; i <= end; i++) range.add(i);
    setSelectedRows(range);
    setSelectedColumns(new Set());
  }, []);

  const selectCell = useCallback((rowIndex: number, field: string) => {
    if (isSystemColumn(field)) return;
    setSelectedRows(new Set([rowIndex]));
    setSelectedColumns(new Set([field]));
    lastClickedRowRef.current = rowIndex;
    lastClickedColumnRef.current = field;
  }, []);

  const rangeCellSelect = useCallback(
    (rowIndex: number, field: string) => {
      if (isSystemColumn(field)) return;
      if (lastClickedRowRef.current === null || lastClickedColumnRef.current !== field) {
        selectCell(rowIndex, field);
        return;
      }
      const start = Math.min(lastClickedRowRef.current, rowIndex);
      const end = Math.max(lastClickedRowRef.current, rowIndex);
      const range = new Set<number>();
      for (let i = start; i <= end; i++) range.add(i);
      setSelectedRows(range);
      setSelectedColumns(new Set([field]));
    },
    [selectCell]
  );

  const selectAllRows = useCallback(() => {
    const count = rowsLengthRef.current;
    setSelectedRows((prev) => {
      if (prev.size === count) return prev;
      const allRows = new Set<number>();
      for (let i = 0; i < count; i++) allRows.add(i);
      return allRows;
    });
  }, []);

  const selectColumn = useCallback(
    (columnId: string) => {
      setSelectedColumns(new Set([columnId]));
      selectAllRows();
      lastClickedRowRef.current = null;
      lastClickedColumnRef.current = columnId;
    },
    [selectAllRows]
  );

  const rangeSelectColumn = useCallback(
    (columnId: string) => {
      if (!lastClickedColumnRef.current) return;
      const allColumnIds = columnOrderRef.current;
      const startIdx = allColumnIds.indexOf(lastClickedColumnRef.current);
      const endIdx = allColumnIds.indexOf(columnId);
      if (startIdx === -1 || endIdx === -1) return;
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      setSelectedColumns(new Set(allColumnIds.slice(from, to + 1)));
      selectAllRows();
      lastClickedRowRef.current = null;
    },
    [selectAllRows]
  );

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

  const whereKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && activeQueryId && queryConnectionId && currentQuery?.sourceTable) {
        applyWhereFilter(activeQueryId, queryConnectionId, whereClause).then((errorMessage) => {
          if (errorMessage) setWhereFilterError(errorMessage);
        });
      }
    },
    [activeQueryId, queryConnectionId, currentQuery?.sourceTable, whereClause, applyWhereFilter]
  );

  const whereApply = useCallback(() => {
    if (activeQueryId && queryConnectionId) {
      applyWhereFilter(activeQueryId, queryConnectionId, whereClause).then((errorMessage) => {
        if (errorMessage) setWhereFilterError(errorMessage);
      });
    }
  }, [activeQueryId, queryConnectionId, whereClause, applyWhereFilter]);

  const whereClear = useCallback(() => {
    setWhereClause('');
    setWhereFilterError(null);
    if (activeQueryId && queryConnectionId) {
      applyWhereFilter(activeQueryId, queryConnectionId, '').then((errorMessage) => {
        if (errorMessage) setWhereFilterError(errorMessage);
      });
    }
  }, [activeQueryId, queryConnectionId, applyWhereFilter]);

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
        <button className={styles.errorDetailButton} onClick={() => setIsErrorDialogOpen(true)}>
          詳細を表示
        </button>
        <ErrorDetailDialog
          isOpen={isErrorDialogOpen}
          errorMessage={error}
          onClose={() => setIsErrorDialogOpen(false)}
        />
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
            <kbd>Ctrl+Enter</kbd> SQLを実行
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
        onChangeViewMode={changeViewMode}
      />

      {currentQuery?.sourceTable && (
        <GridFilterBar
          whereClause={whereClause}
          isExecuting={isExecuting}
          onWhereChange={setWhereClause}
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
      />

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        resultSet={resultSet}
      />

      <ValueEditorDialog
        isOpen={valueEditorState.isOpen}
        columnName={valueEditorState.columnName}
        initialValue={valueEditorState.value}
        onSave={saveValueEditor}
        onCancel={() => setValueEditorState((prev) => ({ ...prev, isOpen: false }))}
      />

      <DmlPreviewDialog
        isOpen={previewStatements.length > 0}
        statements={previewStatements}
        isExecuting={isApplying}
        onExecute={executePreview}
        onCancel={dismissPreview}
      />

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
