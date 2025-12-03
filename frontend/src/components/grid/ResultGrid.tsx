import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useEditStore } from '../../store/editStore';
import { useQueryStore } from '../../store/queryStore';
import { ExportDialog } from '../export/ExportDialog';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import styles from './ResultGrid.module.css';

export function ResultGrid() {
  const { activeQueryId, results, isExecuting, error } = useQueryStore();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
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
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const resultSet = activeQueryId ? results.get(activeQueryId) : null;

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!resultSet) return [];
    return resultSet.columns.map((col) => ({
      field: col.name,
      headerName: col.name,
      headerTooltip: `${col.name} (${col.type})`,
      sortable: true,
      filter: true,
      resizable: true,
      editable: isEditMode,
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
    }));
  }, [resultSet, isEditMode, getCellChange, isRowDeleted]);

  const rowData = useMemo(() => {
    if (!resultSet) return [];
    return resultSet.rows.map((row, rowIndex) => {
      const obj: Record<string, string | null> = { __rowIndex: String(rowIndex + 1) };
      resultSet.columns.forEach((col, idx) => {
        const value = row[idx];
        obj[col.name] = value === '' || value === undefined ? null : value;
      });
      return obj;
    });
  }, [resultSet]);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    params.api.sizeColumnsToFit();
    setGridApi(params.api);
  }, []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const rowIndex = event.node.rowIndex ?? -1;
      const columnName = event.colDef.field ?? '';
      const originalValue = event.oldValue;
      const newValue = event.newValue;
      const rowData = event.node.data as Record<string, string | null>;

      updateCell(rowIndex, columnName, originalValue, newValue, rowData);

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
    selectedNodes.forEach((node) => {
      const rowIndex = node.rowIndex;
      if (rowIndex !== null && rowIndex !== undefined) {
        if (isRowDeleted(rowIndex)) {
          unmarkRowDeleted(rowIndex);
        } else {
          const rowData = node.data as Record<string, string | null>;
          markRowDeleted(rowIndex, rowData);
        }
      }
    });
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

      // Execute each statement
      for (const sql of allStatements) {
        await bridge.executeQuery(activeConnectionId, sql);
      }

      // Clear pending changes on success
      revertAll();

      if (gridApi) {
        gridApi.refreshCells({ force: true });
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
      const startColIndex =
        gridApi.getColumns()?.findIndex((col) => col === focusedCell.column) ?? 0;
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

  // Keyboard shortcuts for copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gridApi) return;

      // Only handle when grid container is focused
      const gridContainer = document.querySelector('.ag-theme-alpine-dark');
      if (!gridContainer?.contains(document.activeElement)) return;

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
      <div className={`ag-theme-alpine-dark ${styles.grid}`}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{
            flex: 1,
            minWidth: 100,
            sortable: true,
            filter: true,
            resizable: true,
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
