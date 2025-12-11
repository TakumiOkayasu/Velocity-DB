import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useEditStore } from '../../store/editStore';
import { useActiveQuery, useQueryActions, useQueryStore } from '../../store/queryStore';
import { log } from '../../utils/logger';
import { ExportDialog } from '../export/ExportDialog';
import styles from './ResultGrid.module.css';

type RowData = Record<string, string | null>;

interface ResultGridProps {
  queryId?: string;
  excludeDataView?: boolean;
}

export function ResultGrid({ queryId, excludeDataView = false }: ResultGridProps = {}) {
  const { activeQueryId, queries, results, isExecuting, error } = useQueryStore();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeQueryFromStore = useActiveQuery();

  const currentActiveQuery = queries.find((q) => q.id === activeQueryId);
  const isActiveDataView = currentActiveQuery?.isDataView === true;
  const targetQueryId = excludeDataView && isActiveDataView ? null : (queryId ?? activeQueryId);

  log.debug(
    `[ResultGrid] Render: targetQueryId=${targetQueryId}, activeQueryId=${activeQueryId}, excludeDataView=${excludeDataView}, isActiveDataView=${isActiveDataView}`
  );

  const { applyWhereFilter } = useQueryActions();
  const [whereClause, setWhereClause] = useState('');
  const {
    isEditMode,
    setEditMode,
    updateCell,
    revertAll,
    hasChanges,
    getCellChange,
    isRowDeleted,
    markRowDeleted,
    unmarkRowDeleted,
    generateUpdateSQL,
    generateInsertSQL,
    generateDeleteSQL,
  } = useEditStore();

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const resultSet = targetQueryId ? (results[targetQueryId] ?? null) : null;
  const currentQuery = queries.find((q) => q.id === targetQueryId);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Convert resultSet to row data
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

  // Helper function to check if a column type is numeric
  const isNumericType = (type: string): boolean => {
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
  };

  // Define columns
  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!resultSet) return [];

    const cols: ColumnDef<RowData>[] = [
      {
        id: '__rowIndex',
        header: '#',
        accessorKey: '__rowIndex',
        size: 60,
        minSize: 60,
        maxSize: 80,
      },
    ];

    for (const col of resultSet.columns) {
      const isNumeric = isNumericType(col.type);
      cols.push({
        id: col.name,
        header: col.name,
        accessorKey: col.name,
        size: 150,
        minSize: 100,
        meta: {
          type: col.type,
          align: isNumeric ? 'right' : 'left',
        },
      });
    }

    return cols;
  }, [resultSet]);

  // TanStack Table instance
  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  // Virtual scrolling
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

  // Event handlers
  const handleToggleEditMode = useCallback(() => {
    setEditMode(!isEditMode);
    if (isEditMode) {
      revertAll();
    }
  }, [isEditMode, setEditMode, revertAll]);

  const handleRevertChanges = useCallback(() => {
    revertAll();
  }, [revertAll]);

  const handleDeleteRow = useCallback(() => {
    for (const rowIndex of selectedRows) {
      if (isRowDeleted(rowIndex)) {
        unmarkRowDeleted(rowIndex);
      } else {
        markRowDeleted(rowIndex, rowData[rowIndex]);
      }
    }
  }, [selectedRows, isRowDeleted, markRowDeleted, unmarkRowDeleted, rowData]);

  const handleApplyChanges = useCallback(async () => {
    if (!activeConnectionId || !currentQuery?.sourceTable) return;

    setIsApplying(true);
    setApplyError(null);

    try {
      const updateSQL = generateUpdateSQL();
      const insertSQL = generateInsertSQL();
      const deleteSQL = generateDeleteSQL();

      for (const sql of [...updateSQL, ...insertSQL, ...deleteSQL]) {
        await bridge.executeQuery(activeConnectionId, sql);
      }

      revertAll();
      setEditMode(false);
      setIsApplying(false);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply changes');
      setIsApplying(false);
    }
  }, [
    activeConnectionId,
    currentQuery,
    generateUpdateSQL,
    generateInsertSQL,
    generateDeleteSQL,
    revertAll,
    setEditMode,
  ]);

  const handleAutoSizeColumns = useCallback(() => {
    // TanStack Table handles column sizing automatically
    log.debug('[ResultGrid] Auto-size columns (TanStack Table handles this automatically)');
  }, []);

  const handleCopySelection = useCallback(() => {
    const selectedRowIndices = Array.from(selectedRows).sort((a, b) => a - b);
    if (selectedRowIndices.length === 0) return;

    const headerRow = columns.slice(1).map((col) => String(col.header));
    const dataRows = selectedRowIndices.map((rowIndex) => {
      const row = rowData[rowIndex];
      return columns.slice(1).map((col) => {
        const value = row[String(col.id)];
        return value === null ? 'NULL' : value;
      });
    });

    const tsv = [headerRow, ...dataRows].map((row) => row.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv);
  }, [selectedRows, columns, rowData]);

  const handlePaste = useCallback(async () => {
    if (!isEditMode) return;

    try {
      const text = await navigator.clipboard.readText();
      const pasteRows = text.split('\n').map((row) => row.split('\t'));

      const firstSelectedRow = Math.min(...Array.from(selectedRows));
      if (!Number.isFinite(firstSelectedRow)) return;

      pasteRows.forEach((pasteRow, rowOffset) => {
        const targetRowIndex = firstSelectedRow + rowOffset;
        if (targetRowIndex >= rowData.length) return;

        pasteRow.forEach((cellValue, colOffset) => {
          const col = columns[colOffset + 1];
          if (!col) return;

          const field = String(col.id);
          const oldValue = rowData[targetRowIndex][field];
          const newValue = cellValue === 'NULL' ? null : cellValue;

          updateCell(targetRowIndex, field, oldValue, newValue);
        });
      });
    } catch (err) {
      console.error('Failed to paste:', err);
    }
  }, [isEditMode, selectedRows, rowData, columns, updateCell]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tableContainerRef.current?.contains(document.activeElement)) return;

      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        handleCopySelection();
      } else if (e.ctrlKey && e.key === 'v' && isEditMode) {
        e.preventDefault();
        handlePaste();
      } else if (e.key === 'Delete' && isEditMode) {
        e.preventDefault();
        handleDeleteRow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, handleCopySelection, handlePaste, handleDeleteRow]);

  // Loading state
  if (isExecuting) {
    return (
      <div className={styles.message}>
        <span className={styles.spinner}>{'\u23F3'}</span>
        <span>Executing query...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    log.debug(`[ResultGrid] Showing error: ${error}`);
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>Error: {error}</span>
      </div>
    );
  }

  // No data
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
        <button
          type="button"
          onClick={handleAutoSizeColumns}
          className={styles.toolbarButton}
          disabled={true}
          title="Auto-size All Columns (handled automatically)"
        >
          Resize Columns
        </button>
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
        <table className={styles.table}>
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

                    return (
                      <td
                        key={cell.id}
                        className={`${styles.td} ${isNull ? styles.nullCell : ''} ${isChanged ? styles.changedCell : ''}`}
                        style={{
                          width: cell.column.getSize(),
                          textAlign: align as 'left' | 'right' | 'center',
                        }}
                      >
                        {isNull ? 'NULL' : String(value)}
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
