import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../../api/bridge';
import { type CellChange, useEditStore } from '../../../store/editStore';
import type { Query, ResultSet } from '../../../types';
import { parseTableName, type RowData } from '../../../types/grid';
import { log } from '../../../utils/logger';

interface UseGridEditOptions {
  resultSet: ResultSet | null;
  currentQuery: Query | undefined;
  activeConnectionId: string | null;
  rowData: RowData[];
  selectedRows: Set<number>;
}

interface UseGridEditResult {
  isEditMode: boolean;
  hasChanges: () => boolean;
  isApplying: boolean;
  applyError: string | null;
  isRowDeleted: (rowIndex: number) => boolean;
  isRowInserted: (rowIndex: number) => boolean;
  getInsertedRows: () => Map<number, Record<string, string | null>>;
  getCellChange: (rowIndex: number, field: string) => CellChange | null;
  updateCell: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
  handleToggleEditMode: () => void;
  handleRevertChanges: () => void;
  handleDeleteRow: () => void;
  handleCloneRow: () => void;
  handleApplyChanges: () => Promise<void>;
}

export function useGridEdit({
  resultSet,
  currentQuery,
  activeConnectionId,
  rowData,
  selectedRows,
}: UseGridEditOptions): UseGridEditResult {
  const {
    isEditMode,
    setEditMode,
    updateCell,
    revertAll,
    hasChanges,
    getCellChange,
    isRowDeleted,
    isRowInserted,
    insertedRows,
    markRowDeleted,
    unmarkRowDeleted,
    addNewRow,
    getDmlParams,
    setTableContext,
    clearTableContext,
    primaryKeyColumns,
  } = useEditStore();

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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

  const handleCloneRow = useCallback(() => {
    if (selectedRows.size === 0) return;

    for (const rowIndex of selectedRows) {
      const sourceRow = rowData[rowIndex];
      if (!sourceRow) continue;

      // Copy row data, excluding PK columns and internal fields
      const clonedRow: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(sourceRow)) {
        if (key.startsWith('__')) continue;
        // Set PK columns to NULL for new row
        if (primaryKeyColumns.includes(key)) {
          clonedRow[key] = null;
        } else {
          clonedRow[key] = value;
        }
      }

      addNewRow(clonedRow);
    }
  }, [selectedRows, rowData, primaryKeyColumns, addNewRow]);

  const handleApplyChanges = useCallback(async () => {
    if (!activeConnectionId || !currentQuery?.sourceTable) return;

    const dmlParams = getDmlParams();
    if (!dmlParams) return;

    setIsApplying(true);
    setApplyError(null);

    try {
      const { statements } = await bridge.buildDmlStatements(activeConnectionId, dmlParams);

      if (statements.length > 0) {
        await bridge.executeQuery(activeConnectionId, statements.join('\n'));
      }

      revertAll();
      setEditMode(false);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setIsApplying(false);
    }
  }, [activeConnectionId, currentQuery, getDmlParams, revertAll, setEditMode]);

  // Set table context for editing when resultSet or sourceTable changes
  useEffect(() => {
    if (resultSet && currentQuery?.sourceTable) {
      const { schema, table } = parseTableName(currentQuery.sourceTable);

      const pkColumns = resultSet.columns.filter((col) => col.isPrimaryKey).map((col) => col.name);

      setTableContext(table, schema, pkColumns);
      log.debug(`[useGridEdit] Set table context: ${schema}.${table}, PK: ${pkColumns.join(', ')}`);
    } else {
      clearTableContext();
    }

    return () => {
      if (!isEditMode) {
        clearTableContext();
      }
    };
  }, [resultSet, currentQuery?.sourceTable, setTableContext, clearTableContext, isEditMode]);

  const getInsertedRows = useCallback(() => new Map(insertedRows), [insertedRows]);

  // Wrap updateCell to auto-inject rowData for correct originalData tracking
  const updateCellWithRow = useCallback(
    (rowIndex: number, field: string, oldValue: string | null, newValue: string | null) => {
      updateCell(rowIndex, field, oldValue, newValue, rowData[rowIndex]);
    },
    [updateCell, rowData]
  );

  return {
    isEditMode,
    hasChanges,
    isApplying,
    applyError,
    isRowDeleted,
    isRowInserted,
    getInsertedRows,
    getCellChange,
    updateCell: updateCellWithRow,
    handleToggleEditMode,
    handleRevertChanges,
    handleDeleteRow,
    handleCloneRow,
    handleApplyChanges,
  };
}
