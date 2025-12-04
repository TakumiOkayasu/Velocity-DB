import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  IRowNode,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useEditStore } from '../../store/editStore';
import { useActiveQuery, useQueryActions, useQueryStore } from '../../store/queryStore';
import { darkTheme } from '../../theme/agGridTheme';
import { ExportDialog } from '../export/ExportDialog';
import styles from './ResultGrid.module.css';

type RowData = Record<string, string | null>;

function isRowData(data: unknown): data is RowData {
  if (data === null || typeof data !== 'object') return false;
  return Object.values(data as object).every((v) => v === null || typeof v === 'string');
}

function getRowData(node: IRowNode): RowData | null {
  if (isRowData(node.data)) return node.data;
  return null;
}

interface ResultGridProps {
  queryId?: string; // Optional: if provided, shows result for this specific query instead of active query
  excludeDataView?: boolean; // If true, don't show results when active query is a data view
}

export function ResultGrid({ queryId, excludeDataView = false }: ResultGridProps = {}) {
  const { activeQueryId, queries, results, isExecuting, error } = useQueryStore();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeQueryFromStore = useActiveQuery();

  // When excludeDataView is true, check if the active query is a data view
  const currentActiveQuery = queries.find((q) => q.id === activeQueryId);
  const isActiveDataView = currentActiveQuery?.isDataView === true;

  // If excludeDataView and active query is a data view, don't show any result
  const targetQueryId = excludeDataView && isActiveDataView ? null : (queryId ?? activeQueryId);
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
  const gridRef = useRef<AgGridReact>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const resultSet = targetQueryId ? (results[targetQueryId] ?? null) : null;

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!resultSet) return [];

    // Calculate optimal width for each column based on header and content (use larger)
    const calculateColumnWidth = (colName: string, colIndex: number): number => {
      const CHAR_WIDTH = 9; // Approximate character width in pixels (monospace)
      const HEADER_PADDING = 48; // Header padding (includes sort/filter icons)
      const CELL_PADDING = 24; // Cell padding
      const MAX_WIDTH = 400;

      // Calculate header width - this is the minimum width to show full header
      const headerWidth = colName.length * CHAR_WIDTH + HEADER_PADDING;

      // Find max content length from first 100 rows
      let maxContentLength = 0;
      const sampleSize = Math.min(resultSet.rows.length, 100);
      for (let i = 0; i < sampleSize; i++) {
        const cellValue = resultSet.rows[i][colIndex];
        const displayValue = cellValue === null || cellValue === '' ? 'NULL' : cellValue;
        maxContentLength = Math.max(maxContentLength, displayValue.length);
      }
      const contentWidth = maxContentLength * CHAR_WIDTH + CELL_PADDING;

      // Use the larger of header width and content width (header is minimum)
      const calculatedWidth = Math.max(headerWidth, contentWidth);
      return Math.min(MAX_WIDTH, calculatedWidth);
    };

    // Helper function to check if a column type is numeric
    const isNumericType = (typeName: string): boolean => {
      const numericTypes = [
        'int',
        'integer',
        'bigint',
        'smallint',
        'tinyint',
        'decimal',
        'numeric',
        'money',
        'smallmoney',
        'float',
        'real',
        'double',
        'number',
        'bit',
      ];
      const lowerType = typeName.toLowerCase();
      return numericTypes.some((t) => lowerType.includes(t));
    };

    return resultSet.columns.map((col, colIndex) => {
      const isNumeric = isNumericType(col.type);

      return {
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.name} (${col.type})`,
        width: calculateColumnWidth(col.name, colIndex),
        sortable: true,
        filter: true,
        resizable: false,
        editable: isEditMode,
        // Right-align numeric columns, left-align others (headers stay centered)
        cellStyle: isNumeric ? { textAlign: 'right' } : { textAlign: 'left' },
        cellClass: (params: CellClassParams) => {
          const classes: string[] = [];
          const rowIndex = params.node?.rowIndex ?? -1;

          // NULL styling
          if (params.value === null || params.value === '') {
            classes.push(styles.nullCell);
          }

          // Changed cell styling
          const change = getCellChange(rowIndex, col.name);
          if (change) {
            classes.push(styles.changedCell);
          }

          // Deleted row styling
          if (isRowDeleted(rowIndex)) {
            classes.push(styles.deletedRow);
          }

          return classes.join(' ');
        },
        valueFormatter: (params) => {
          if (params.value === null || params.value === undefined) {
            return 'NULL';
          }
          return params.value;
        },
      };
    });
  }, [resultSet, isEditMode, getCellChange, isRowDeleted]);

  const rowData = useMemo(() => {
    if (!resultSet) return [];
    return resultSet.rows.map((row, rowIndex) => {
      const obj: Record<string, string | null> = {
        __rowIndex: String(rowIndex + 1),
      };
      resultSet.columns.forEach((col, idx) => {
        const value = row[idx];
        obj[col.name] = value === '' || value === undefined ? null : value;
      });
      return obj;
    });
  }, [resultSet]);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    setGridApi(params.api);
  }, []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const rowIndex = event.node.rowIndex ?? -1;
      const columnName = event.colDef.field ?? '';
      const originalValue = event.oldValue;
      const newValue = event.newValue;
      const rowDataValue = getRowData(event.node);

      if (rowDataValue) {
        updateCell(rowIndex, columnName, originalValue, newValue, rowDataValue);
      }

      // Refresh the cell to update styling
      if (gridApi) {
        gridApi.refreshCells({ rowNodes: [event.node], force: true });
      }
    },
    [updateCell, gridApi]
  );

  const handleToggleEditMode = useCallback(() => {
    if (isEditMode && hasChanges()) {
      const confirmed = window.confirm('You have unsaved changes. Discard them?');
      if (!confirmed) return;
      revertAll();
    }
    setEditMode(!isEditMode);
  }, [isEditMode, hasChanges, revertAll, setEditMode]);

  const handleDeleteRow = useCallback(() => {
    if (!gridApi) return;
    const selectedNodes = gridApi.getSelectedNodes();
    for (const node of selectedNodes) {
      const rowIndex = node.rowIndex;
      if (rowIndex !== null && rowIndex !== undefined) {
        if (isRowDeleted(rowIndex)) {
          unmarkRowDeleted(rowIndex);
        } else {
          const rowDataValue = getRowData(node);
          if (rowDataValue) {
            markRowDeleted(rowIndex, rowDataValue);
          }
        }
      }
    }
    gridApi.refreshCells({ force: true });
  }, [gridApi, isRowDeleted, markRowDeleted, unmarkRowDeleted]);

  const handleRevertChanges = useCallback(() => {
    revertAll();
    if (gridApi) {
      gridApi.refreshCells({ force: true });
    }
  }, [revertAll, gridApi]);

  const handleApplyChanges = useCallback(async () => {
    if (!activeConnectionId) {
      setApplyError('No active connection');
      return;
    }

    setIsApplying(true);
    setApplyError(null);

    try {
      // Generate all SQL statements
      const deleteStatements = generateDeleteSQL();
      const updateStatements = generateUpdateSQL();
      const insertStatements = generateInsertSQL();

      const allStatements = [...deleteStatements, ...updateStatements, ...insertStatements];

      if (allStatements.length === 0) {
        setIsApplying(false);
        return;
      }

      // Begin transaction for atomicity
      await bridge.beginTransaction(activeConnectionId);

      try {
        // Execute each statement within transaction
        for (let i = 0; i < allStatements.length; i++) {
          const sql = allStatements[i];
          try {
            await bridge.executeQuery(activeConnectionId, sql, false);
          } catch (stmtError) {
            // Provide detailed error with statement index
            throw new Error(
              `Statement ${i + 1}/${allStatements.length} failed: ${stmtError instanceof Error ? stmtError.message : 'Unknown error'}`
            );
          }
        }

        // Commit transaction on success
        await bridge.commit(activeConnectionId);

        // Clear pending changes on success
        revertAll();

        if (gridApi) {
          gridApi.refreshCells({ force: true });
        }
      } catch (txError) {
        // Rollback transaction on any error
        try {
          await bridge.rollback(activeConnectionId);
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
        throw txError;
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'Failed to apply changes');
    } finally {
      setIsApplying(false);
    }
  }, [
    activeConnectionId,
    generateDeleteSQL,
    generateUpdateSQL,
    generateInsertSQL,
    revertAll,
    gridApi,
  ]);

  const handleCopySelection = useCallback(() => {
    if (!gridApi) return;

    const selectedCells = gridApi.getCellRanges();
    if (!selectedCells || selectedCells.length === 0) {
      // Fallback: copy selected rows
      const selectedNodes = gridApi.getSelectedNodes();
      if (selectedNodes.length === 0) return;

      const rows = selectedNodes.map((node) => {
        const data = node.data;
        return Object.keys(data)
          .filter((key) => !key.startsWith('__'))
          .map((key) => data[key] ?? 'NULL')
          .join('\t');
      });
      navigator.clipboard.writeText(rows.join('\n'));
      return;
    }

    // Copy cell range
    const range = selectedCells[0];
    const startRow = Math.min(range.startRow?.rowIndex ?? 0, range.endRow?.rowIndex ?? 0);
    const endRow = Math.max(range.startRow?.rowIndex ?? 0, range.endRow?.rowIndex ?? 0);
    const columns = range.columns;

    const rows: string[] = [];
    for (let i = startRow; i <= endRow; i++) {
      const node = gridApi.getDisplayedRowAtIndex(i);
      if (!node) continue;
      const row = columns.map((col) => {
        const colId = col.getColId();
        const value = node.data[colId];
        return value === null || value === undefined ? 'NULL' : String(value);
      });
      rows.push(row.join('\t'));
    }
    navigator.clipboard.writeText(rows.join('\n'));
  }, [gridApi]);

  const handlePaste = useCallback(async () => {
    if (!gridApi || !isEditMode) return;

    try {
      const text = await navigator.clipboard.readText();
      const rows = text.split('\n').map((row) => row.split('\t'));

      const focusedCell = gridApi.getFocusedCell();
      if (!focusedCell) return;

      const startRow = focusedCell.rowIndex;
      const startColIndex = gridApi.getColumns()?.indexOf(focusedCell.column) ?? 0;
      const columns = gridApi.getColumns() ?? [];

      rows.forEach((row, rowOffset) => {
        const node = gridApi.getDisplayedRowAtIndex(startRow + rowOffset);
        if (!node) return;

        row.forEach((cellValue, colOffset) => {
          const col = columns[startColIndex + colOffset];
          if (!col) return;

          const field = col.getColDef().field;
          if (!field) return;

          const oldValue = node.data[field];
          const newValue = cellValue === 'NULL' ? null : cellValue;

          node.setDataValue(field, newValue);
          updateCell(startRow + rowOffset, field, oldValue, newValue);
        });
      });

      gridApi.refreshCells({ force: true });
    } catch (err) {
      console.error('Failed to paste:', err);
    }
  }, [gridApi, isEditMode, updateCell]);

  const handleApplyWhereFilter = useCallback(() => {
    if (activeQueryId && activeConnectionId && activeQueryFromStore?.sourceTable) {
      applyWhereFilter(activeQueryId, activeConnectionId, whereClause);
    }
  }, [
    activeQueryId,
    activeConnectionId,
    activeQueryFromStore?.sourceTable,
    whereClause,
    applyWhereFilter,
  ]);

  const handleWhereKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleApplyWhereFilter();
      }
    },
    [handleApplyWhereFilter]
  );

  // Keyboard shortcuts for copy/paste
  useEffect(() => {
    const currentGridApi = gridApi;
    const currentGridContainer = gridContainerRef.current;
    const currentIsEditMode = isEditMode;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentGridApi) return;

      // Only handle when grid container is focused
      if (!currentGridContainer?.contains(document.activeElement)) return;

      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        handleCopySelection();
      } else if (e.ctrlKey && e.key === 'v' && currentIsEditMode) {
        e.preventDefault();
        handlePaste();
      } else if (e.key === 'Delete' && currentIsEditMode) {
        e.preventDefault();
        handleDeleteRow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gridApi, isEditMode, handleCopySelection, handlePaste, handleDeleteRow]);

  if (isExecuting) {
    return (
      <div className={styles.message}>
        <span className={styles.spinner}>{'\u23F3'}</span>
        <span>Executing query...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.message} ${styles.error}`}>
        <span>Error: {error}</span>
      </div>
    );
  }

  if (!resultSet) {
    return (
      <div className={styles.message}>
        <span>Execute a query to see results</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          onClick={handleToggleEditMode}
          className={`${styles.toolbarButton} ${isEditMode ? styles.active : ''}`}
          title={isEditMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
        >
          {isEditMode ? 'Exit Edit' : 'Edit'}
        </button>
        {isEditMode && (
          <>
            <button
              onClick={handleDeleteRow}
              className={styles.toolbarButton}
              title="Delete Selected Rows (mark for deletion)"
            >
              Delete Row
            </button>
            <button
              onClick={handleRevertChanges}
              className={styles.toolbarButton}
              disabled={!hasChanges()}
              title="Revert All Changes"
            >
              Revert
            </button>
            <button
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
            onClick={handleApplyWhereFilter}
            className={styles.toolbarButton}
            disabled={isExecuting}
            title="Apply WHERE filter (Enter)"
          >
            Apply
          </button>
          <button
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
      <div ref={gridContainerRef} className={styles.grid}>
        <AgGridReact
          ref={gridRef}
          theme={darkTheme}
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: false,
            suppressMovable: true,
          }}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          enableCellTextSelection={!isEditMode}
          ensureDomOrder={true}
          animateRows={false}
          rowBuffer={20}
          rowSelection="multiple"
          suppressRowClickSelection={false}
          suppressCellFocus={false}
          enableRangeSelection={false}
          copyHeadersToClipboard={true}
          suppressCopyRowsToClipboard={false}
          stopEditingWhenCellsLoseFocus={true}
          singleClickEdit={false}
          suppressColumnVirtualisation={true}
          suppressMovableColumns={true}
        />
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
