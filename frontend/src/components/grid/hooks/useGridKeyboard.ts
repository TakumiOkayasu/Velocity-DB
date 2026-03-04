import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useState } from 'react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { useKeyboardHandler } from '../../../hooks/useKeyboardHandler';
import type { RowData } from '../../../types/grid';

interface EditingCell {
  rowIndex: number;
  columnId: string;
}

interface UseGridKeyboardOptions {
  isEditMode: boolean;
  selectedRows: Set<number>;
  selectedColumn: string | null;
  columns: ColumnDef<RowData>[];
  rowData: RowData[];
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  updateCell: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
  onDeleteRow: () => void;
  onCloneRow: () => void;
  onNavigateRelated?: (rowIndex: number, columnName: string) => void;
  onOpenValueEditor?: (rowIndex: number, columnName: string, currentValue: string | null) => void;
}

interface UseGridKeyboardResult {
  editingCell: EditingCell | null;
  editValue: string;
  setEditValue: React.Dispatch<React.SetStateAction<string>>;
  handleCopySelection: () => Promise<void>;
  handlePaste: () => Promise<void>;
  handleStartEdit: (rowIndex: number, columnId: string, currentValue: string | null) => void;
  handleCommitEdit: () => void;
  handleCancelEdit: () => void;
}

export function useGridKeyboard({
  isEditMode,
  selectedRows,
  selectedColumn,
  columns,
  rowData,
  tableContainerRef,
  updateCell,
  onDeleteRow,
  onCloneRow,
  onNavigateRelated,
  onOpenValueEditor,
}: UseGridKeyboardOptions): UseGridKeyboardResult {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const copyToClipboard = useCopyToClipboard();

  const handleCopySelection = useCallback(async () => {
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
    await copyToClipboard(tsv, `${selectedRowIndices.length}行をコピーしました`);
  }, [selectedRows, columns, rowData, copyToClipboard]);

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

  const handleStartEdit = useCallback(
    (rowIndex: number, columnId: string, currentValue: string | null) => {
      if (!isEditMode || columnId === '__rowIndex') return;
      setEditingCell({ rowIndex, columnId });
      setEditValue(currentValue ?? '');
    },
    [isEditMode]
  );

  const handleCommitEdit = useCallback(() => {
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

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // Keyboard shortcuts
  useKeyboardHandler((e: KeyboardEvent) => {
    // If editing a cell, handle Enter/Escape
    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCommitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelEdit();
      }
      return;
    }

    // Other shortcuts (when not editing a cell)
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      handleCopySelection();
    } else if (e.ctrlKey && e.key === 'v' && isEditMode) {
      e.preventDefault();
      handlePaste();
    } else if (e.key === 'Delete' && isEditMode) {
      e.preventDefault();
      onDeleteRow();
    } else if (e.key === 'F2' && isEditMode && selectedRows.size === 1) {
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      const firstEditableColumn = columns.find((col) => col.id !== '__rowIndex');
      if (firstEditableColumn) {
        const columnId = String(firstEditableColumn.id);
        const currentValue = rowData[rowIndex][columnId];
        handleStartEdit(rowIndex, columnId, currentValue);
      }
    } else if (e.ctrlKey && e.key === 'd' && isEditMode) {
      // Clone row (Ctrl+D) - WebView2環境ではブラウザのブックマーク機能は無効
      e.preventDefault();
      onCloneRow();
    } else if (e.key === 'F4' && selectedRows.size === 1 && selectedColumn) {
      // Navigate to related row (F4)
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      onNavigateRelated?.(rowIndex, selectedColumn);
    } else if (
      e.shiftKey &&
      e.key === 'Enter' &&
      isEditMode &&
      selectedRows.size === 1 &&
      selectedColumn
    ) {
      // Open value editor (Shift+Enter)
      e.preventDefault();
      const rowIndex = Array.from(selectedRows)[0];
      const currentValue = rowData[rowIndex][selectedColumn];
      onOpenValueEditor?.(rowIndex, selectedColumn, currentValue);
    }
  }, tableContainerRef);

  return {
    editingCell,
    editValue,
    setEditValue,
    handleCopySelection,
    handlePaste,
    handleStartEdit,
    handleCommitEdit,
    handleCancelEdit,
  };
}
