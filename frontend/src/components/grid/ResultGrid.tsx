import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useActiveQuery, useQueryActions, useQueryStore } from '../../store/queryStore';
import { useSessionStore } from '../../store/sessionStore';
import type { ResultSet } from '../../types';
import { log } from '../../utils/logger';
import { ExportDialog } from '../export/ExportDialog';
import { useColumnAutoSize } from './hooks/useColumnAutoSize';
import { useGridEdit } from './hooks/useGridEdit';
import { useGridKeyboard } from './hooks/useGridKeyboard';
import styles from './ResultGrid.module.css';

type RowData = Record<string, string | null>;

interface ResultGridProps {
  queryId?: string;
  excludeDataView?: boolean;
}

export function ResultGrid({ queryId, excludeDataView = false }: ResultGridProps = {}) {
  const activeQueryId = useQueryStore((state) => state.activeQueryId);
  const queries = useQueryStore((state) => state.queries);
  const results = useQueryStore((state) => state.results);
  const isExecuting = useQueryStore((state) => state.isExecuting);
  const error = useQueryStore((state) => state.error);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeQueryFromStore = useActiveQuery();
  const { showLogicalNamesInGrid, setShowLogicalNamesInGrid } = useSessionStore();

  const currentActiveQuery = queries.find((q) => q.id === activeQueryId);
  const isActiveDataView = currentActiveQuery?.isDataView === true;
  const targetQueryId = excludeDataView && isActiveDataView ? null : (queryId ?? activeQueryId);

  log.debug(
    `[ResultGrid] Render: targetQueryId=${targetQueryId}, activeQueryId=${activeQueryId}, excludeDataView=${excludeDataView}, isActiveDataView=${isActiveDataView}`
  );

  const { applyWhereFilter } = useQueryActions();
  const [whereClause, setWhereClause] = useState('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [activeResultIndex, setActiveResultIndex] = useState(0);

  const queryResult = targetQueryId ? (results[targetQueryId] ?? null) : null;
  const currentQuery = queries.find((q) => q.id === targetQueryId);

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

  const rowData = useMemo<RowData[]>(() => {
    if (!resultSet) return [];

    const rows = resultSet.rows;
    const cols = resultSet.columns;
    const result = new Array(rows.length);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const obj: Record<string, string | null> = {
        __rowIndex: String(rowIndex + 1),
      };

      for (let colIdx = 0; colIdx < cols.length; colIdx++) {
        const value = row[colIdx];
        obj[cols[colIdx].name] = value === '' || value === undefined ? null : value;
      }

      result[rowIndex] = obj;
    }

    return result;
  }, [resultSet]);

  const isNumericType = useCallback((type: string): boolean => {
    const numericTypes = [
      'int',
      'bigint',
      'smallint',
      'tinyint',
      'decimal',
      'numeric',
      'float',
      'real',
      'money',
      'smallmoney',
    ];
    return numericTypes.some((t) => type.toLowerCase().includes(t));
  }, []);

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
  }, [resultSet, isNumericType, showLogicalNamesInGrid]);

  // Column Auto Size Hook
  const { columnSizing, setColumnSizing } = useColumnAutoSize({
    resultSet,
    columns,
    rowData,
  });

  // Grid Edit Hook
  const {
    isEditMode,
    hasChanges,
    isApplying,
    applyError,
    isRowDeleted,
    getCellChange,
    updateCell,
    handleToggleEditMode,
    handleRevertChanges,
    handleDeleteRow,
    handleApplyChanges,
  } = useGridEdit({
    resultSet,
    currentQuery,
    activeConnectionId,
    rowData,
    selectedRows,
  });

  // Grid Keyboard Hook
  const { editingCell, editValue, setEditValue, handleStartEdit, handleConfirmEdit } =
    useGridKeyboard({
      isEditMode,
      selectedRows,
      columns,
      rowData,
      tableContainerRef,
      updateCell,
      onDeleteRow: handleDeleteRow,
    });

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
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
        if (activeQueryId && activeConnectionId && activeQueryFromStore?.sourceTable) {
          applyWhereFilter(activeQueryId, activeConnectionId, whereClause);
        }
      }
    },
    [activeQueryId, activeConnectionId, activeQueryFromStore, whereClause, applyWhereFilter]
  );

  useEffect(() => {
    setActiveResultIndex(0);
  }, []);

  if (isExecuting) {
    return (
      <div className={styles.message}>
        <span className={styles.spinner}>{'\u23F3'}</span>
        <span>Executing query...</span>
      </div>
    );
  }

  if (error) {
    log.debug(`[ResultGrid] Showing error: ${error}`);
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>Error: {error}</span>
      </div>
    );
  }

  if (!resultSet) {
    log.debug('[ResultGrid] Showing "Execute a query" message');
    return (
      <div className={styles.message}>
        <span>Execute a query to see results</span>
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
        <button
          type="button"
          onClick={handleToggleEditMode}
          className={`${styles.toolbarButton} ${isEditMode ? styles.active : ''}`}
          title={isEditMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
        >
          {isEditMode ? 'Exit Edit' : 'Edit'}
        </button>
        {isEditMode && (
          <>
            <button
              type="button"
              onClick={handleDeleteRow}
              className={styles.toolbarButton}
              title="Delete Selected Rows (mark for deletion)"
            >
              Delete Row
            </button>
            <button
              type="button"
              onClick={handleRevertChanges}
              className={styles.toolbarButton}
              disabled={!hasChanges()}
              title="Revert All Changes"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={handleApplyChanges}
              className={`${styles.toolbarButton} ${styles.applyButton}`}
              disabled={!hasChanges() || isApplying}
              title="Apply Changes to Database"
            >
              {isApplying ? 'Applying...' : 'Apply'}
            </button>
          </>
        )}
        {hasChanges() && <span className={styles.changesIndicator}>Unsaved changes</span>}
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
          onClick={() => setIsExportDialogOpen(true)}
          className={styles.toolbarButton}
          title="Export Data"
        >
          Export
        </button>
      </div>

      {activeQueryFromStore?.sourceTable && (
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>WHERE</span>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="e.g. id > 100 AND name LIKE '%test%'"
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
            title="Apply WHERE filter (Enter)"
          >
            Apply
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
            title="Clear filter"
          >
            Clear
          </button>
        </div>
      )}

      <div ref={tableContainerRef} className={styles.tableContainer}>
        <table key={`table-${showLogicalNamesInGrid}`} className={styles.table}>
          <thead className={styles.thead}>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className={styles.theadRow}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={styles.th}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
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
              const isSelected = selectedRows.has(rowIndex);
              const isDeleted = isRowDeleted(rowIndex);

              return (
                <tr
                  key={row.id}
                  className={`${styles.tbodyRow} ${isSelected ? styles.selected : ''} ${isDeleted ? styles.deleted : ''}`}
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
                    const change = field !== '__rowIndex' ? getCellChange(rowIndex, field) : null;
                    const isChanged = change !== null;
                    const isNull = value === null || value === '';
                    const align =
                      (cell.column.columnDef.meta as { align?: string })?.align ?? 'left';
                    const isEditing =
                      editingCell?.rowIndex === rowIndex && editingCell?.columnId === field;
                    const isEditable = isEditMode && field !== '__rowIndex';

                    return (
                      <td
                        key={cell.id}
                        className={`${styles.td} ${isNull ? styles.nullCell : ''} ${isChanged ? styles.changedCell : ''}`}
                        style={{
                          width: cell.column.getSize(),
                          textAlign: isNull ? 'center' : (align as 'left' | 'right' | 'center'),
                        }}
                        onDoubleClick={() => {
                          if (isEditable) {
                            handleStartEdit(rowIndex, field, value as string | null);
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
        <span>{resultSet.rows.length} rows</span>
        <span>|</span>
        <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
        {resultSet.affectedRows > 0 && (
          <>
            <span>|</span>
            <span>{resultSet.affectedRows} affected</span>
          </>
        )}
        {isEditMode && <span className={styles.editModeIndicator}>EDIT MODE</span>}
      </div>

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        resultSet={resultSet}
      />
    </div>
  );
}
