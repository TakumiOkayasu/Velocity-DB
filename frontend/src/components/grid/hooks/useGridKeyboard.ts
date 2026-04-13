import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useState } from 'react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { useKeyboardHandler } from '../../../hooks/useKeyboardHandler';
import { isSystemColumn, type RowData } from '../../../types/grid';

interface EditingCell {
  rowIndex: number;
  columnId: string;
}

interface UseGridKeyboardOptions {
  isEditMode: boolean;
  selectedRows: Set<number>;
  selectedColumns: Set<string>;
  columns: ColumnDef<RowData>[];
  rowData: RowData[];
  /** ソート/フィルタ後のビュー順でrowを取得 */
  getRowByViewIndex: (viewIndex: number) => RowData | undefined;
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  updateCell: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
  onDeleteRow: () => void;
  onCloneRow: () => void;
  onInsertRow: () => void;
  onApplyChanges: () => Promise<void>;
  onNavigateRelated?: (rowIndex: number, columnName: string) => void;
  onOpenValueEditor?: (rowIndex: number, columnName: string, currentValue: string | null) => void;
  onSelectAll?: () => void;
}

interface UseGridKeyboardResult {
  editingCell: EditingCell | null;
  editValue: string;
  setEditValue: React.Dispatch<React.SetStateAction<string>>;
  copySelection: () => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  startEdit: (rowIndex: number, columnId: string, currentValue: string | null) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
}

export function useGridKeyboard({
  isEditMode,
  selectedRows,
  selectedColumns,
  columns,
  rowData,
  getRowByViewIndex,
  tableContainerRef,
  updateCell,
  onDeleteRow,
  onCloneRow,
  onInsertRow,
  onApplyChanges,
  onNavigateRelated,
  onOpenValueEditor,
  onSelectAll,
}: UseGridKeyboardOptions): UseGridKeyboardResult {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const copyToClipboard = useCopyToClipboard();

  const copySelection = useCallback(async () => {
    const selectedRowIndices = Array.from(selectedRows).sort((a, b) => a - b);
    if (selectedRowIndices.length === 0) return;

    // 列選択モード: 選択列の値のみコピー（ソート/フィルタ後の表示順）
    if (selectedColumns.size > 0) {
      const allColumnIds = columns.map((c) => String(c.id));
      const cols = allColumnIds.filter((id) => selectedColumns.has(id));
      if (cols.length === 1) {
        const col = cols[0];
        const values = selectedRowIndices.map((viewIndex) => {
          const row = getRowByViewIndex(viewIndex);
          if (!row) return 'NULL';
          const value = row[col];
          return value === null ? 'NULL' : value;
        });
        await copyToClipboard(values.join('\n'), `${values.length}件の値をコピーしました`);
        return;
      }
      if (cols.length > 1) {
        const headerMap = new Map(columns.map((c) => [String(c.id), String(c.header ?? c.id)]));
        const headerRow = cols.map((col) => headerMap.get(col) ?? col);
        const dataRows = selectedRowIndices.map((viewIndex) => {
          const row = getRowByViewIndex(viewIndex);
          return cols.map((col) => {
            const value = row?.[col] ?? null;
            return value === null ? 'NULL' : value;
          });
        });
        const tsv = [headerRow.join('\t'), ...dataRows.map((r) => r.join('\t'))].join('\n');
        await copyToClipboard(
          tsv,
          `${cols.length}列 × ${selectedRowIndices.length}行をコピーしました`
        );
        return;
      }
      // cols.length === 0: selectedColumns にデータ列が含まれない → 全列コピーにフォールバック
    }

    const headerRow = columns.map((col) => String(col.header));
    const dataRows = selectedRowIndices.map((viewIndex) => {
      const row = getRowByViewIndex(viewIndex);
      return columns.map((col) => {
        const value = row?.[String(col.id)] ?? null;
        return value === null ? 'NULL' : value;
      });
    });

    const tsv = [headerRow, ...dataRows].map((row) => row.join('\t')).join('\n');
    await copyToClipboard(tsv, `${selectedRowIndices.length}行をコピーしました`);
  }, [selectedRows, selectedColumns, columns, getRowByViewIndex, copyToClipboard]);

  const copySqlInsert = useCallback(async () => {
    const selectedRowIndices = Array.from(selectedRows).sort((a, b) => a - b);
    if (selectedRowIndices.length === 0) return;

    const colNames = columns.map((col) => String(col.id));
    const statements = selectedRowIndices
      .map((viewIndex) => {
        const row = getRowByViewIndex(viewIndex);
        if (!row) return '';
        const values = colNames.map((colName) => {
          const value = row[colName];
          if (value === null) return 'NULL';
          return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
        });
        return `INSERT INTO table_name (${colNames.join(', ')}) VALUES (${values.join(', ')});`;
      })
      .filter(Boolean);

    await copyToClipboard(statements.join('\n'), 'SQL INSERTをコピーしました');
  }, [selectedRows, columns, getRowByViewIndex, copyToClipboard]);

  const pasteFromClipboard = useCallback(async () => {
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
          const col = columns[colOffset];
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

  const startEdit = useCallback(
    (rowIndex: number, columnId: string, currentValue: string | null) => {
      if (!isEditMode || isSystemColumn(columnId)) return;
      setEditingCell({ rowIndex, columnId });
      setEditValue(currentValue ?? '');
    },
    [isEditMode]
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) return;

    const { rowIndex, columnId } = editingCell;
    const oldValue = rowData[rowIndex][columnId];
    const newValue = editValue === '' ? null : editValue;

    if (oldValue !== newValue) {
      updateCell(rowIndex, columnId, oldValue, newValue);
    }

    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, rowData, updateCell]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const setNull = useCallback(() => {
    if (!isEditMode || selectedRows.size !== 1 || selectedColumns.size !== 1) return;
    const rowIndex = Array.from(selectedRows)[0];
    const col = Array.from(selectedColumns)[0];
    const oldValue = rowData[rowIndex][col];
    if (oldValue !== null) {
      updateCell(rowIndex, col, oldValue, null);
    }
  }, [isEditMode, selectedRows, selectedColumns, rowData, updateCell]);

  // Keyboard shortcuts
  useKeyboardHandler((e: KeyboardEvent) => {
    // If editing a cell, handle Enter/Escape
    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
      return;
    }

    // Ctrl+S: Save changes
    if (e.ctrlKey && !e.shiftKey && e.key === 's') {
      e.preventDefault();
      onApplyChanges();
      return;
    }

    // Ctrl+Shift+C: Copy as SQL INSERT
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      copySqlInsert();
      return;
    }

    // Ctrl+Shift+N: Set NULL
    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      setNull();
      return;
    }

    // Ctrl+A: Select all rows (INPUT/TEXTAREA/contenteditable focus 中は既定動作優先)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return;
      e.preventDefault();
      onSelectAll?.();
      return;
    }

    // Other shortcuts (when not editing a cell)
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      copySelection();
    } else if (e.ctrlKey && e.key === 'v' && isEditMode) {
      e.preventDefault();
      pasteFromClipboard();
    } else if (e.key === 'Delete' && isEditMode) {
      e.preventDefault();
      onDeleteRow();
    } else if (e.key === 'Insert' && isEditMode) {
      e.preventDefault();
      onInsertRow();
    } else if (e.key === 'F2' && isEditMode && selectedRows.size === 1) {
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      const firstCol = selectedColumns.size === 1 ? Array.from(selectedColumns)[0] : undefined;
      const columnId =
        firstCol && !isSystemColumn(firstCol)
          ? firstCol
          : String(columns.find((col) => !isSystemColumn(String(col.id)))?.id ?? '');
      if (columnId) {
        const currentValue = rowData[rowIndex][columnId];
        startEdit(rowIndex, columnId, currentValue);
      }
    } else if (e.ctrlKey && e.key === 'd' && isEditMode) {
      // Clone row (Ctrl+D)
      e.preventDefault();
      onCloneRow();
    } else if (e.key === 'F4' && selectedRows.size === 1 && selectedColumns.size === 1) {
      // Navigate to related row (F4)
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      const col = Array.from(selectedColumns)[0];
      onNavigateRelated?.(rowIndex, col);
    } else if (
      e.shiftKey &&
      e.key === 'Enter' &&
      isEditMode &&
      selectedRows.size === 1 &&
      selectedColumns.size === 1
    ) {
      // Open value editor (Shift+Enter)
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      const col = Array.from(selectedColumns)[0];
      const currentValue = rowData[rowIndex][col];
      onOpenValueEditor?.(rowIndex, col, currentValue);
    }
  }, tableContainerRef);

  return {
    editingCell,
    editValue,
    setEditValue,
    copySelection,
    pasteFromClipboard,
    startEdit,
    commitEdit,
    cancelEdit,
  };
}
