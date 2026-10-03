import { useCallback, useEffect, useRef, useState } from 'react';
import { queryProvider } from '../../../api/providers';
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
  onApplied?: () => Promise<void>;
}

interface UseGridEditResult {
  isEditMode: boolean;
  hasChanges: boolean;
  isApplying: boolean;
  applyError: string | null;
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
  applyChanges: () => Promise<void>;
}

export function useGridEdit({
  resultSet,
  currentQuery,
  activeConnectionId,
  rowData,
  selectedRows,
  isReadOnly,
  onApplied,
}: UseGridEditOptions): UseGridEditResult {
  const {
    updateCell,
    revertAll,
    hasChanges: hasChangesFn,
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
    deletedRows,
    validationErrors,
    setValidationErrors,
    hasValidationErrors: hasValidationErrorsFn,
  } = useEditStore();

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const contextVersion = useRef(0);
  const getCellChange = useCallback(
    (rowIndex: number, field: string) => pendingChanges.get(rowIndex)?.changes[field] ?? null,
    [pendingChanges]
  );
  const isRowDeleted = useCallback((rowIndex: number) => deletedRows.has(rowIndex), [deletedRows]);
  const getValidationError = useCallback(
    (rowIndex: number, field: string) => validationErrors.get(`${rowIndex}:${field}`) ?? null,
    [validationErrors]
  );

  // Edit mode is always ON when sourceTable exists and not read-only
  const isEditMode = !!currentQuery?.sourceTable && !isReadOnly && !isApplying;

  // Sync edit mode to store
  useEffect(() => {
    setEditMode(isEditMode);
  }, [isEditMode, setEditMode]);

  const revertChanges = useCallback(() => {
    if (applyingRef.current) return;
    revertAll();
  }, [revertAll]);

  const deleteRow = useCallback(() => {
    if (applyingRef.current) return;
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
    if (applyingRef.current) return;
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
    setValidationErrors(errors);
  }, [resultSet, pendingChanges, insertedRows, setValidationErrors]);

  const insertRow = useCallback(() => {
    if (applyingRef.current) return;
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

  const applyChanges = useCallback(async () => {
    if (applyingRef.current) return;
    if (isReadOnly) {
      setApplyError('読み取り専用モードのため変更を適用できません');
      return;
    }
    if (!activeConnectionId || !currentQuery?.sourceTable || !resultSet) return;
    // Ctrl+S may have just committed the active cell, before the validation effect runs.
    const state = useEditStore.getState();
    const errors = validateNullConstraints(
      resultSet.columns,
      state.pendingChanges,
      state.insertedRows
    );
    setValidationErrors(errors);
    if (errors.size > 0) {
      setApplyError(
        'バリデーションエラーがあります。NULLが許可されていないカラムを確認してください'
      );
      return;
    }
    const dmlParams = getDmlParams();
    if (!dmlParams || !hasChangesFn()) return;
    const version = contextVersion.current;
    applyingRef.current = true;
    setIsApplying(true);
    setApplyError(null);
    try {
      const { statements } = await queryProvider.buildDmlStatements(activeConnectionId, dmlParams);
      if (statements.length === 0 || contextVersion.current !== version) return;
      // The backend executes a multi-statement batch in a transaction.
      await queryProvider.executeQuery(activeConnectionId, statements.join('\n'), false);
      if (contextVersion.current === version) {
        revertAll();
        await onApplied?.();
      }
    } catch (err) {
      if (contextVersion.current === version) {
        setApplyError(err instanceof Error ? err.message : 'Failed to apply changes');
      }
    } finally {
      applyingRef.current = false;
      setIsApplying(false);
    }
  }, [
    isReadOnly,
    activeConnectionId,
    currentQuery?.sourceTable,
    resultSet,
    getDmlParams,
    hasChangesFn,
    setValidationErrors,
    revertAll,
    onApplied,
  ]);

  // Set table context for editing when resultSet or sourceTable changes
  useEffect(() => {
    contextVersion.current += 1;
    if (resultSet && currentQuery?.sourceTable) {
      const { schema, table } = parseTableName(currentQuery.sourceTable);

      const pkColumns = resultSet.columns.filter((col) => col.isPrimaryKey).map((col) => col.name);

      setTableContext(table, schema, pkColumns);
      log.debug(`[useGridEdit] Set table context: ${schema}.${table}, PK: ${pkColumns.join(', ')}`);
    } else {
      clearTableContext();
    }

    return () => {
      contextVersion.current += 1;
      clearTableContext();
    };
  }, [resultSet, currentQuery?.id, currentQuery?.sourceTable, setTableContext, clearTableContext]);

  const getInsertedRows = useCallback(() => insertedRows, [insertedRows]);

  const updateCellWithRow = useCallback(
    (rowIndex: number, field: string, oldValue: string | null, newValue: string | null) => {
      if (isReadOnly || applyingRef.current) return;
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
    isRowInserted,
    getInsertedRows,
    hasValidationErrors,
    updateCell: updateCellWithRow,
    revertChanges,
    deleteRow,
    cloneRow,
    insertRow,
    applyChanges,
    getCellChange,
    isRowDeleted,
    getValidationError,
  };
}
