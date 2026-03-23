import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../../api/bridge';
import { type CellChange, useEditStore } from '../../../store/editStore';
import type { Query, ResultSet } from '../../../types';
import { parseTableName, type RowData } from '../../../types/grid';
import { log } from '../../../utils/logger';
import { type ValidationError, validateNullConstraints } from '../../../utils/validation';

interface UseGridEditOptions {
  resultSet: ResultSet | null;
  currentQuery: Query | undefined;
  activeConnectionId: string | null;
  rowData: RowData[];
  selectedRows: Set<number>;
  isReadOnly: boolean;
}

interface UseGridEditResult {
  isEditMode: boolean;
  hasChanges: boolean;
  isApplying: boolean;
  applyError: string | null;
  previewStatements: string[];
  isRowDeleted: (rowIndex: number) => boolean;
  isRowInserted: (rowIndex: number) => boolean;
  getInsertedRows: () => Map<number, Record<string, string | null>>;
  getCellChange: (rowIndex: number, field: string) => CellChange | null;
  getValidationError: (rowIndex: number, field: string) => ValidationError | null;
  hasValidationErrors: boolean;
  updateCell: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
  revertChanges: () => void;
  deleteRow: () => void;
  cloneRow: () => void;
  insertRow: () => void;
  buildPreview: () => Promise<void>;
  executePreview: () => Promise<void>;
  dismissPreview: () => void;
}

export function useGridEdit({
  resultSet,
  currentQuery,
  activeConnectionId,
  rowData,
  selectedRows,
  isReadOnly,
}: UseGridEditOptions): UseGridEditResult {
  const {
    updateCell,
    revertAll,
    hasChanges: hasChangesFn,
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
    setEditMode,
    pendingChanges,
    validationErrors,
    setValidationErrors,
    getValidationError,
    hasValidationErrors: hasValidationErrorsFn,
  } = useEditStore();

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [previewStatements, setPreviewStatements] = useState<string[]>([]);

  // Edit mode is always ON when sourceTable exists and not read-only
  const isEditMode = !!currentQuery?.sourceTable && !isReadOnly;

  // Sync edit mode to store
  useEffect(() => {
    setEditMode(isEditMode);
  }, [isEditMode, setEditMode]);

  const revertChanges = useCallback(() => {
    revertAll();
  }, [revertAll]);

  const deleteRow = useCallback(() => {
    if (isReadOnly) {
      setApplyError('読み取り専用モードのため変更できません');
      return;
    }
    for (const rowIndex of selectedRows) {
      if (isRowDeleted(rowIndex)) {
        unmarkRowDeleted(rowIndex);
      } else {
        const row = rowData[rowIndex];
        if (!row) continue;
        markRowDeleted(rowIndex, row);
      }
    }
  }, [isReadOnly, selectedRows, isRowDeleted, markRowDeleted, unmarkRowDeleted, rowData]);

  const cloneRow = useCallback(() => {
    if (isReadOnly) {
      setApplyError('読み取り専用モードのため変更できません');
      return;
    }
    if (selectedRows.size === 0) return;

    for (const rowIndex of selectedRows) {
      const sourceRow = rowData[rowIndex];
      if (!sourceRow) continue;

      const clonedRow: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(sourceRow)) {
        if (key.startsWith('__')) continue;
        if (primaryKeyColumns.includes(key)) {
          clonedRow[key] = null;
        } else {
          clonedRow[key] = value;
        }
      }

      addNewRow(clonedRow);
    }
  }, [isReadOnly, selectedRows, rowData, primaryKeyColumns, addNewRow]);

  // Validate NOT NULL constraints whenever changes occur
  useEffect(() => {
    if (!resultSet) return;
    const errors = validateNullConstraints(resultSet.columns, pendingChanges, insertedRows);
    if (errors.size === 0 && validationErrors.size === 0) return;
    setValidationErrors(errors);
  }, [resultSet, pendingChanges, insertedRows, validationErrors, setValidationErrors]);

  const insertRow = useCallback(() => {
    if (isReadOnly) {
      setApplyError('読み取り専用モードのため変更できません');
      return;
    }
    if (!resultSet) return;

    const newRow: Record<string, string | null> = {};
    for (const col of resultSet.columns) {
      newRow[col.name] = null;
    }
    addNewRow(newRow);
  }, [isReadOnly, resultSet, addNewRow]);

  const buildPreview = useCallback(async () => {
    if (isReadOnly) {
      setApplyError('読み取り専用モードのため変更を適用できません');
      return;
    }
    if (hasValidationErrorsFn()) {
      setApplyError(
        'バリデーションエラーがあります。NULLが許可されていないカラムを確認してください'
      );
      return;
    }
    if (!activeConnectionId || !currentQuery?.sourceTable) return;

    const dmlParams = getDmlParams();
    if (!dmlParams) return;

    setApplyError(null);

    try {
      const { statements } = await bridge.buildDmlStatements(activeConnectionId, dmlParams);
      if (statements.length > 0) {
        setPreviewStatements(statements);
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to build DML');
    }
  }, [isReadOnly, activeConnectionId, currentQuery, getDmlParams, hasValidationErrorsFn]);

  const executePreview = useCallback(async () => {
    if (!activeConnectionId || previewStatements.length === 0) return;

    setIsApplying(true);
    setApplyError(null);

    try {
      await bridge.executeQuery(activeConnectionId, previewStatements.join('\n'));
      revertAll();
      setPreviewStatements([]);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply changes');
      setPreviewStatements([]);
    } finally {
      setIsApplying(false);
    }
  }, [activeConnectionId, previewStatements, revertAll]);

  const dismissPreview = useCallback(() => {
    setPreviewStatements([]);
  }, []);

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
      clearTableContext();
    };
  }, [resultSet, currentQuery?.sourceTable, setTableContext, clearTableContext]);

  const getInsertedRows = useCallback(() => insertedRows, [insertedRows]);

  const updateCellWithRow = useCallback(
    (rowIndex: number, field: string, oldValue: string | null, newValue: string | null) => {
      if (isReadOnly) return;
      updateCell(rowIndex, field, oldValue, newValue, rowData[rowIndex]);
    },
    [isReadOnly, updateCell, rowData]
  );

  const hasChanges = hasChangesFn();
  const hasValidationErrors = hasValidationErrorsFn();

  return {
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
    updateCell: updateCellWithRow,
    revertChanges,
    deleteRow,
    cloneRow,
    insertRow,
    buildPreview,
    executePreview,
    dismissPreview,
  };
}
