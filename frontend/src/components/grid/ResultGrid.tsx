import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  IRowNode,
  IServerSideDatasource,
  IServerSideGetRowsParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import { useEditStore } from '../../store/editStore';
import { useActiveQuery, useQueryActions, useQueryStore } from '../../store/queryStore';
import { darkTheme } from '../../theme/agGridTheme';
import { log } from '../../utils/logger';
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
  const gridRef = useRef<AgGridReact>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const resultSet = targetQueryId ? (results[targetQueryId] ?? null) : null;
  const currentQuery = queries.find((q) => q.id === targetQueryId);
  const useServerSide = currentQuery?.useServerSideRowModel ?? false;
  const [totalRows, setTotalRows] = useState<number | undefined>(undefined);

  log.debug(
    `[ResultGrid] State: useServerSide=${useServerSide}, resultSet=${resultSet ? 'exists' : 'null'}, isExecuting=${isExecuting}, error=${error ? 'exists' : 'null'}`
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!resultSet && !useServerSide) {
      log.debug('[ResultGrid] columnDefs: returning empty (no resultSet, not serverSide)');
      return [];
    }

    // For server-side mode without initial result, return empty until first data arrives
    if (useServerSide && !resultSet) {
      log.debug('[ResultGrid] columnDefs: returning empty (serverSide without resultSet)');
      return [];
    }

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

    // Helper function to check if a column type is text
    const isTextType = (typeName: string): boolean => {
      const textTypes = ['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext', 'string'];
      const lowerType = typeName.toLowerCase();
      return textTypes.some((t) => lowerType.includes(t));
    };

    // Determine text alignment based on column type
    const getCellAlignment = (typeName: string): string => {
      if (isNumericType(typeName)) {
        return 'right'; // Numbers: right-align
      }
      if (isTextType(typeName)) {
        return 'left'; // Text: left-align
      }
      return 'center'; // Others (date, time, etc.): center-align
    };

    if (!resultSet) {
      log.debug('[ResultGrid] columnDefs: no resultSet, returning empty');
      return [];
    }

    log.debug(`[ResultGrid] columnDefs: generating from ${resultSet.columns.length} columns`);
    return resultSet.columns.map((col) => {
      const alignment = getCellAlignment(col.type);

      return {
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.name} (${col.type})`,
        sortable: true,
        filter: true,
        resizable: true,
        editable: isEditMode,
        // Align based on column type: numbers right, text left, others center
        cellStyle: { textAlign: alignment },
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
  }, [resultSet, isEditMode, getCellChange, isRowDeleted, useServerSide]);

  log.debug(`[ResultGrid] columnDefs computed: ${columnDefs.length} columns`);

  // For large datasets, skip memoization to avoid memory overhead
  const rowData = useMemo(() => {
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

  // Create server-side datasource for paginated data loading
  const createServerSideDatasource = useCallback((): IServerSideDatasource => {
    return {
      getRows: async (params: IServerSideGetRowsParams) => {
        log.debug(
          `[ResultGrid] getRows called, startRow: ${params.request.startRow}, endRow: ${params.request.endRow}`
        );
        log.debug(
          `[ResultGrid] activeConnectionId: ${activeConnectionId}, query: ${currentQuery?.content?.substring(0, 50)}`
        );

        if (!activeConnectionId || !currentQuery?.content) {
          log.error('[ResultGrid] getRows failed: missing connection or query');
          params.fail();
          return;
        }

        try {
          const startRow = params.request.startRow ?? 0;
          const endRow = params.request.endRow ?? 100;
          log.debug(`[ResultGrid] Fetching rows ${startRow} - ${endRow}`);

          // Convert AG Grid sort model to backend format
          const sortModel = params.request.sortModel.map((sort) => ({
            colId: sort.colId,
            sort: sort.sort as 'asc' | 'desc',
          }));

          // Fetch paginated data
          const result = await bridge.executeQueryPaginated(
            activeConnectionId,
            currentQuery.content,
            startRow,
            endRow,
            sortModel.length > 0 ? sortModel : undefined
          );

          // Store columns in resultSet for the first request
          if (startRow === 0) {
            const resultSet = {
              columns: result.columns.map((c) => ({
                name: c.name,
                type: c.type,
                size: 0,
                nullable: true,
                isPrimaryKey: false,
              })),
              rows: result.rows,
              affectedRows: result.affectedRows,
              executionTimeMs: result.executionTimeMs,
            };

            // Update results in store so columnDefs can be generated
            if (targetQueryId) {
              useQueryStore.setState((state) => ({
                results: { ...state.results, [targetQueryId]: resultSet },
              }));
            }

            // Fetch total row count (only on first load)
            if (totalRows === undefined) {
              bridge
                .getRowCount(activeConnectionId, currentQuery.content)
                .then((countResult) => {
                  setTotalRows(countResult.rowCount);
                })
                .catch(console.error);
            }
          }

          // Convert rows to AG Grid format
          const rowData = result.rows.map((row, index) => {
            const obj: Record<string, string | null> = {
              __rowIndex: String(startRow + index + 1),
            };
            for (let colIdx = 0; colIdx < result.columns.length; colIdx++) {
              const value = row[colIdx];
              obj[result.columns[colIdx].name] = value === '' || value === undefined ? null : value;
            }
            return obj;
          });

          // Determine last row
          const lastRow =
            totalRows ??
            (result.rows.length < endRow - startRow ? startRow + result.rows.length : undefined);

          log.debug(`[ResultGrid] getRows success: ${rowData.length} rows, lastRow: ${lastRow}`);
          params.success({
            rowData,
            rowCount: lastRow,
          });
        } catch (error) {
          log.error(`[ResultGrid] Server-side datasource error: ${error}`);
          params.fail();
        }
      },
    };
  }, [activeConnectionId, currentQuery, targetQueryId, totalRows]);

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      log.debug(
        `[ResultGrid] onGridReady called, useServerSide: ${useServerSide}, queryId: ${targetQueryId}`
      );
      setGridApi(params.api);

      // Set server-side datasource for server-side row model
      if (useServerSide) {
        log.debug('[ResultGrid] Setting server-side datasource');
        params.api.setGridOption('serverSideDatasource', createServerSideDatasource());
        params.api.showLoadingOverlay();
      } else {
        // Auto-size all columns to fit content after grid is ready
        // Skip auto-size for large datasets (>10000 rows) to improve performance
        if (resultSet && resultSet.rows.length <= 10000) {
          params.api.autoSizeAllColumns();
        }
      }
    },
    [resultSet, useServerSide, createServerSideDatasource, targetQueryId]
  );

  // Auto-size columns when data changes (only for small datasets)
  useEffect(() => {
    if (gridApi && resultSet && resultSet.rows.length <= 10000) {
      // Wait for rendering to complete, then auto-size all columns
      requestAnimationFrame(() => {
        gridApi.autoSizeAllColumns();
      });
    }
  }, [gridApi, resultSet]);

  // Cleanup gridApi on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (gridApi) {
        gridApi.destroy();
      }
    };
  }, [gridApi]);

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

  const handleAutoSizeColumns = useCallback(() => {
    if (gridApi) {
      gridApi.autoSizeAllColumns();
    }
  }, [gridApi]);

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

  // Show loading state for executing queries
  if (isExecuting) {
    log.debug('[ResultGrid] Showing loading state (isExecuting)');
    return (
      <div className={styles.message}>
        <span>Loading data...</span>
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

  // Show message when no data
  if (!resultSet) {
    log.debug('[ResultGrid] Showing "Execute a query" message (!resultSet)');
    return (
      <div className={styles.message}>
        <span>Execute a query to see results</span>
      </div>
    );
  }

  log.debug('[ResultGrid] Rendering grid component');

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
          onClick={handleAutoSizeColumns}
          className={styles.toolbarButton}
          disabled={!gridApi}
          title="Auto-size All Columns"
        >
          Resize Columns
        </button>
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
          rowData={useServerSide ? undefined : rowData}
          rowModelType={useServerSide ? 'serverSide' : 'clientSide'}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          defaultColDef={{
            sortable: true,
            filter: !useServerSide,
            resizable: true,
            suppressMovable: true,
          }}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          enableCellTextSelection={!isEditMode}
          ensureDomOrder={false}
          animateRows={false}
          rowBuffer={20}
          rowSelection="multiple"
          suppressRowClickSelection={false}
          suppressCellFocus={true}
          enableRangeSelection={false}
          copyHeadersToClipboard={true}
          suppressCopyRowsToClipboard={false}
          stopEditingWhenCellsLoseFocus={true}
          singleClickEdit={false}
          suppressColumnVirtualisation={false}
          suppressMovableColumns={true}
          suppressRowVirtualisation={false}
          debounceVerticalScrollbar={true}
          suppressRowHoverHighlight={false}
          suppressAnimationFrame={true}
        />
      </div>
      <div className={styles.statusBar}>
        {useServerSide ? (
          <span>
            {totalRows !== undefined
              ? `${totalRows.toLocaleString()} rows (server-side)`
              : 'Loading...'}
          </span>
        ) : (
          <>
            <span>{resultSet?.rows.length ?? 0} rows</span>
            <span>|</span>
            <span>{resultSet?.executionTimeMs.toFixed(2) ?? 0} ms</span>
            {resultSet && resultSet.affectedRows > 0 && (
              <>
                <span>|</span>
                <span>{resultSet.affectedRows} affected</span>
              </>
            )}
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
