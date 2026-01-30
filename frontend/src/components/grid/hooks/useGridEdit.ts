import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../../api/bridge';
import { type CellChange, useEditStore } from '../../../store/editStore';
import type { Query, ResultSet } from '../../../types';
import { log } from '../../../utils/logger';

type RowData = Record<string, string | null>;

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
    markRowDeleted,
    unmarkRowDeleted,
    generateUpdateSQL,
    generateInsertSQL,
    generateDeleteSQL,
    setTableContext,
    clearTableContext,
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

  // Set table context for editing when resultSet or sourceTable changes
  useEffect(() => {
    if (resultSet && currentQuery?.sourceTable) {
      const sourceTable = currentQuery.sourceTable;
      const parts = sourceTable.split('.');

      let tableName: string;
      let schemaName: string | null = null;

      if (parts.length === 2) {
        schemaName = parts[0].replace(/[[\]]/g, '');
        tableName = parts[1].replace(/[[\]]/g, '');
      } else {
        tableName = sourceTable.replace(/[[\]]/g, '');
      }

      const primaryKeyColumns = resultSet.columns
        .filter((col) => col.isPrimaryKey)
        .map((col) => col.name);

      setTableContext(tableName, schemaName ?? 'dbo', primaryKeyColumns);
      log.debug(
        `[useGridEdit] Set table context: ${schemaName}.${tableName}, PK: ${primaryKeyColumns.join(', ')}`
      );
    } else {
      clearTableContext();
    }

    return () => {
      if (!isEditMode) {
        clearTableContext();
      }
    };
  }, [resultSet, currentQuery?.sourceTable, setTableContext, clearTableContext, isEditMode]);

  return {
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
  };
}
