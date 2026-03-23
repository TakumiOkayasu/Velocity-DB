import type { RowChange } from '../store/editStore';
import type { Column } from '../types';

export interface ValidationError {
  rowIndex: number;
  columnName: string;
  message: string;
}

export function validateNullConstraints(
  columns: Column[],
  pendingChanges: Map<number, RowChange>,
  insertedRows: Map<number, Record<string, string | null>>
): Map<string, ValidationError> {
  const errors = new Map<string, ValidationError>();
  const notNullColumns = new Set(columns.filter((c) => !c.nullable).map((c) => c.name));

  // UPDATE: newValue === null on NOT NULL column
  for (const [, rowChange] of pendingChanges) {
    for (const change of Object.values(rowChange.changes)) {
      if (change.newValue === null && notNullColumns.has(change.columnName)) {
        const key = `${change.rowIndex}:${change.columnName}`;
        errors.set(key, {
          rowIndex: change.rowIndex,
          columnName: change.columnName,
          message: `${change.columnName}: NULLは許可されていません`,
        });
      }
    }
  }

  // INSERT: value === null on NOT NULL column
  for (const [rowIndex, rowData] of insertedRows) {
    for (const [columnName, value] of Object.entries(rowData)) {
      if (columnName.startsWith('__')) continue;
      if (value === null && notNullColumns.has(columnName)) {
        const key = `${rowIndex}:${columnName}`;
        errors.set(key, {
          rowIndex,
          columnName,
          message: `${columnName}: NULLは許可されていません`,
        });
      }
    }
  }

  return errors;
}
