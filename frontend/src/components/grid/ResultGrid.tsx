import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import {
  useIsActiveDataView,
  useQueryActions,
  useQueryById,
  useQueryResult,
  useQueryStore,
} from '../../store/queryStore';
import { useSessionStore } from '../../store/sessionStore';
import type { ResultSet } from '../../types';
import { isNumericType, type RowData } from '../../types/grid';
import { log } from '../../utils/logger';
import { ExportDialog } from '../export/ExportDialog';
import { useColumnAutoSize } from './hooks/useColumnAutoSize';
import { useGridEdit } from './hooks/useGridEdit';
import { useGridKeyboard } from './hooks/useGridKeyboard';
import { useRelatedRows } from './hooks/useRelatedRows';
import styles from './ResultGrid.module.css';
import { ValueEditorDialog } from './ValueEditorDialog';

interface ResultGridProps {
  queryId?: string;
  excludeDataView?: boolean;
}

function ResultGridInner({ queryId, excludeDataView = false }: ResultGridProps = {}) {
  // Targeted store subscriptions (primitives - cheap)
  const activeQueryId = useQueryStore((state) => state.activeQueryId);
  const isExecuting = useQueryStore((state) => state.isExecuting);
  const error = useQueryStore((state) => state.error);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);

  const isActiveDataView = useIsActiveDataView();
  const targetQueryId = excludeDataView && isActiveDataView ? null : (queryId ?? activeQueryId);
  const currentQuery = useQueryById(targetQueryId);
  const queryResult = useQueryResult(targetQueryId);

  // Session store with targeted selectors (not entire store)
  const showLogicalNamesInGrid = useSessionStore((state) => state.showLogicalNamesInGrid);
  const setShowLogicalNamesInGrid = useSessionStore((state) => state.setShowLogicalNamesInGrid);

  log.debug(
    `[ResultGrid] Render: targetQueryId=${targetQueryId}, activeQueryId=${activeQueryId}, excludeDataView=${excludeDataView}, isActiveDataView=${isActiveDataView}`
  );

  const { applyWhereFilter, refreshDataView, openTableData } = useQueryActions();
  const [whereClause, setWhereClause] = useState('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [valueEditorState, setValueEditorState] = useState<{
    isOpen: boolean;
    rowIndex: number;
    columnName: string;
    value: string | null;
  }>({ isOpen: false, rowIndex: 0, columnName: '', value: null });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [showColumnFilters, setShowColumnFilters] = useState(false);

  const isMultipleResults =
    queryResult && 'multipleResults' in queryResult && queryResult.multipleResults === true;

  const filteredResults = isMultipleResults
    ? queryResult.results.filter((r) => !r.statement.trim().toUpperCase().startsWith('USE '))
    : null;

  const hasFilteredResults = filteredResults && filteredResults.length > 0;

  const resultSet: ResultSet | null = hasFilteredResults
    ? (filteredResults[activeResultIndex]?.data ?? null)
    : isMultipleResults
      ? null
      : (queryResult as ResultSet | null);

  const tableContainerRef = useRef<HTMLDivElement>(null);

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
        obj[cols[colIdx].name] = value === '' || value === undefined ? null : value;
      }

      result[rowIndex] = obj;
    }

    return result;
  }, [resultSet]);

  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!resultSet) return [];

    const cols: ColumnDef<RowData>[] = [];

    for (const col of resultSet.columns) {
      const isNumeric = isNumericType(col.type);
      const displayName = showLogicalNamesInGrid && col.comment ? col.comment : col.name;
      cols.push({
        id: col.name,
        header: displayName,
        accessorKey: col.name,
        size: 150,
        minSize: 80,
        meta: {
          type: col.type,
          align: isNumeric ? 'right' : 'left',
        },
      });
    }

    return cols;
  }, [resultSet, showLogicalNamesInGrid]);

  // Column Auto Size Hook
  const { columnSizing, setColumnSizing } = useColumnAutoSize({
    resultSet,
    columns,
    rowData: baseRowData,
  });

  // Grid Edit Hook
  const {
    isEditMode,
    hasChanges,
    isApplying,
    applyError,
    isRowDeleted,
    isRowInserted,
    getInsertedRows,
    getCellChange,
    updateCell,
    handleToggleEditMode,
    handleRevertChanges,
    handleDeleteRow,
    handleCloneRow,
    handleApplyChanges,
  } = useGridEdit({
    resultSet,
    currentQuery,
    activeConnectionId,
    rowData: baseRowData,
    selectedRows,
  });

  // Combine base row data with inserted rows
  const rowData = useMemo<RowData[]>(() => {
    const insertedRows = getInsertedRows();
    if (insertedRows.size === 0) return baseRowData;

    const combined = [...baseRowData];
    insertedRows.forEach((rowValues, rowIndex) => {
      combined.push({
        ...rowValues,
        __rowIndex: '新規',
        __originalIndex: String(rowIndex),
      });
    });

    return combined;
  }, [baseRowData, getInsertedRows]);

  // Memoize callback to prevent useRelatedRows from recreating navigateToRelatedRow every render
  const handleOpenRelatedTable = useCallback(
    (tableName: string, fkWhereClause: string) => {
      if (activeConnectionId) {
        openTableData(activeConnectionId, tableName, fkWhereClause);
      }
    },
    [activeConnectionId, openTableData]
  );

  // Related Rows Hook (FK navigation)
  const { isForeignKeyColumn, navigateToRelatedRow } = useRelatedRows({
    connectionId: activeConnectionId,
    tableName: currentQuery?.sourceTable ?? null,
    onOpenRelatedTable: handleOpenRelatedTable,
  });

  const handleNavigateRelated = useCallback(
    (rowIndex: number, columnName: string) => {
      const row = rowData[rowIndex];
      if (!row) return;
      navigateToRelatedRow(columnName, row);
    },
    [rowData, navigateToRelatedRow]
  );

  const handleOpenValueEditor = useCallback(
    (rowIndex: number, columnName: string, currentValue: string | null) => {
      setValueEditorState({
        isOpen: true,
        rowIndex,
        columnName,
        value: currentValue,
      });
    },
    []
  );

  const handleValueEditorSave = useCallback(
    (newValue: string | null) => {
      const { rowIndex, columnName, value: oldValue } = valueEditorState;
      if (oldValue !== newValue) {
        updateCell(rowIndex, columnName, oldValue, newValue);
      }
      setValueEditorState((prev) => ({ ...prev, isOpen: false }));
    },
    [valueEditorState, updateCell]
  );

  const handleValueEditorCancel = useCallback(() => {
    setValueEditorState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Grid Keyboard Hook
  const { editingCell, editValue, setEditValue, handleStartEdit, handleConfirmEdit } =
    useGridKeyboard({
      isEditMode,
      selectedRows,
      selectedColumn,
      columns,
      rowData,
      tableContainerRef,
      updateCell,
      onDeleteRow: handleDeleteRow,
      onCloneRow: handleCloneRow,
      onNavigateRelated: handleNavigateRelated,
      onOpenValueEditor: handleOpenValueEditor,
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
    state: {
      columnSizing,
      sorting,
      columnFilters,
    },
    onColumnSizingChange: setColumnSizing,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
  });

  const { rows } = table.getRowModel();
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  const handleWhereKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (activeQueryId && activeConnectionId && currentQuery?.sourceTable) {
          applyWhereFilter(activeQueryId, activeConnectionId, whereClause);
        }
      }
    },
    [activeQueryId, activeConnectionId, currentQuery?.sourceTable, whereClause, applyWhereFilter]
  );

  useEffect(() => {
    setActiveResultIndex(0);
  }, []);

  if (isExecuting) {
    return (
      <div className={styles.message}>
        <span className={styles.spinner}>{'\u23F3'}</span>
        <span>クエリ実行中...</span>
      </div>
    );
  }

  if (error) {
    log.debug(`[ResultGrid] Showing error: ${error}`);
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>エラー: {error}</span>
      </div>
    );
  }

  if (!resultSet) {
    log.debug('[ResultGrid] Showing "Execute a query" message');
    return (
      <div className={styles.message}>
        <span>クエリを実行して結果を表示</span>
      </div>
    );
  }

  log.debug('[ResultGrid] Rendering TanStack Table');

  return (
    <div className={styles.container}>
      {hasFilteredResults && (
        <div className={styles.resultTabs}>
          {filteredResults.map((result, index) => (
            <button
              key={`${result.statement}-${index}`}
              className={`${styles.resultTab} ${activeResultIndex === index ? styles.activeResultTab : ''}`}
              onClick={() => setActiveResultIndex(index)}
              title={result.statement}
            >
              {result.statement.length > 50
                ? `${result.statement.substring(0, 50)}...`
                : result.statement}
            </button>
          ))}
        </div>
      )}

      <div className={styles.toolbar}>
        {currentQuery?.sourceTable && activeConnectionId && (
          <button
            type="button"
            onClick={() => {
              if (targetQueryId) {
                refreshDataView(targetQueryId, activeConnectionId);
              }
            }}
            className={styles.toolbarButton}
            title="データを再取得 (F5)"
          >
            更新
          </button>
        )}
        <button
          type="button"
          onClick={handleToggleEditMode}
          className={`${styles.toolbarButton} ${isEditMode ? styles.active : ''}`}
          title={isEditMode ? '編集モード終了' : '編集モード開始'}
        >
          {isEditMode ? '編集終了' : '編集'}
        </button>
        {isEditMode && (
          <>
            <button
              type="button"
              onClick={handleDeleteRow}
              className={styles.toolbarButton}
              title="選択行を削除（削除マーク）"
            >
              行削除
            </button>
            <button
              type="button"
              onClick={handleRevertChanges}
              className={styles.toolbarButton}
              disabled={!hasChanges()}
              title="すべての変更を元に戻す"
            >
              元に戻す
            </button>
            <button
              type="button"
              onClick={handleApplyChanges}
              className={`${styles.toolbarButton} ${styles.applyButton}`}
              disabled={!hasChanges() || isApplying}
              title="変更をデータベースに適用"
            >
              {isApplying ? '適用中...' : '適用'}
            </button>
          </>
        )}
        {hasChanges() && <span className={styles.changesIndicator}>未保存の変更あり</span>}
        {applyError && <span className={styles.errorIndicator}>{applyError}</span>}
        <div className={styles.toolbarSpacer} />
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showLogicalNamesInGrid}
            onChange={(e) => setShowLogicalNamesInGrid(e.target.checked)}
          />
          <span>論理名で表示</span>
        </label>
        <button
          type="button"
          onClick={() => {
            setShowColumnFilters((prev) => !prev);
            if (showColumnFilters) {
              setColumnFilters([]);
            }
          }}
          className={`${styles.toolbarButton} ${showColumnFilters ? styles.active : ''}`}
          title="列フィルタを表示/非表示"
        >
          フィルタ
        </button>
        <button
          type="button"
          onClick={() => setIsExportDialogOpen(true)}
          className={styles.toolbarButton}
          title="データをエクスポート"
        >
          エクスポート
        </button>
      </div>

      {currentQuery?.sourceTable && (
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>WHERE</span>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="例: id > 100 AND name LIKE '%test%'"
            value={whereClause}
            onChange={(e) => setWhereClause(e.target.value)}
            onKeyDown={handleWhereKeyDown}
          />
          <button
            type="button"
            onClick={() => {
              if (activeQueryId && activeConnectionId) {
                applyWhereFilter(activeQueryId, activeConnectionId, whereClause);
              }
            }}
            className={styles.toolbarButton}
            disabled={isExecuting}
            title="WHEREフィルタを適用 (Enter)"
          >
            適用
          </button>
          <button
            type="button"
            onClick={() => {
              setWhereClause('');
              if (activeQueryId && activeConnectionId) {
                applyWhereFilter(activeQueryId, activeConnectionId, '');
              }
            }}
            className={styles.toolbarButton}
            disabled={isExecuting || !whereClause}
            title="フィルタをクリア"
          >
            クリア
          </button>
        </div>
      )}

      <div ref={tableContainerRef} className={styles.tableContainer}>
        <table key={`table-${showLogicalNamesInGrid}`} className={styles.table}>
          <thead className={styles.thead}>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className={styles.theadRow}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={[styles.th, canSort && styles.sortable].filter(Boolean).join(' ')}
                      style={{
                        width: header.getSize(),
                        minWidth: header.column.columnDef.minSize,
                        maxWidth: header.column.columnDef.maxSize,
                      }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className={styles.thContent}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDirection && (
                          <span className={styles.sortIndicator}>
                            {sortDirection === 'asc' ? ' \u25B2' : ' \u25BC'}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
            {showColumnFilters && (
              <tr className={styles.filterRow}>
                {table.getHeaderGroups()[0]?.headers.map((header) => (
                  <th key={`filter-${header.id}`} className={styles.filterCell}>
                    <input
                      type="text"
                      className={styles.columnFilterInput}
                      placeholder="..."
                      value={(header.column.getFilterValue() as string) ?? ''}
                      onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody className={styles.tbody}>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const rowIndex = virtualRow.index;
              const originalIndex = Number(row.original.__originalIndex);
              const isSelected = selectedRows.has(rowIndex);
              const isDeleted = isRowDeleted(originalIndex);
              const isInserted = isRowInserted(originalIndex);

              const rowClasses = [
                styles.tbodyRow,
                isSelected && styles.selected,
                isDeleted && styles.deleted,
                isInserted && styles.inserted,
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <tr
                  key={row.id}
                  className={rowClasses}
                  onClick={() => {
                    setSelectedRows((prev) => {
                      const next = new Set(prev);
                      if (next.has(rowIndex)) {
                        next.delete(rowIndex);
                      } else {
                        next.add(rowIndex);
                      }
                      return next;
                    });
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const value = cell.getValue();
                    const field = cell.column.id;
                    const change =
                      field !== '__rowIndex' && field !== '__originalIndex'
                        ? getCellChange(originalIndex, field)
                        : null;
                    const isChanged = change !== null;
                    const isNull = value === null || value === '';
                    const align =
                      (cell.column.columnDef.meta as { align?: string })?.align ?? 'left';
                    const isEditing =
                      editingCell?.rowIndex === originalIndex && editingCell?.columnId === field;
                    const isEditable =
                      isEditMode && field !== '__rowIndex' && field !== '__originalIndex';
                    const isFk = isForeignKeyColumn(field);
                    const isCellSelected = isSelected && selectedColumn === field;

                    const cellClasses = [
                      styles.td,
                      isNull && styles.nullCell,
                      isChanged && styles.changedCell,
                      isFk && styles.fkCell,
                      isCellSelected && styles.selectedCell,
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <td
                        key={cell.id}
                        className={cellClasses}
                        style={{
                          width: cell.column.getSize(),
                          textAlign: isNull ? 'center' : (align as 'left' | 'right' | 'center'),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRows(new Set([rowIndex]));
                          setSelectedColumn(field);
                        }}
                        onDoubleClick={() => {
                          if (isEditable) {
                            handleStartEdit(originalIndex, field, value as string | null);
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            className={styles.cellInput}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleConfirmEdit}
                            autoFocus
                          />
                        ) : isNull ? (
                          'NULL'
                        ) : (
                          String(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.statusBar}>
        <span>
          {columnFilters.length > 0
            ? `${rows.length} / ${resultSet.rows.length} 件 (フィルタ中)`
            : `${resultSet.rows.length} 件`}
        </span>
        <span>|</span>
        <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
        {resultSet.affectedRows > 0 && (
          <>
            <span>|</span>
            <span>{resultSet.affectedRows} 件更新</span>
          </>
        )}
        {isEditMode && <span className={styles.editModeIndicator}>編集モード</span>}
      </div>

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        resultSet={resultSet}
      />

      <ValueEditorDialog
        isOpen={valueEditorState.isOpen}
        columnName={valueEditorState.columnName}
        initialValue={valueEditorState.value}
        onSave={handleValueEditorSave}
        onCancel={handleValueEditorCancel}
      />
    </div>
  );
}

export const ResultGrid = memo(ResultGridInner);
