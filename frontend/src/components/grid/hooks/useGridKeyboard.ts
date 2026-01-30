import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useState } from 'react';

type RowData = Record<string, string | null>;

interface EditingCell {
  rowIndex: number;
  columnId: string;
}

interface UseGridKeyboardOptions {
  isEditMode: boolean;
  selectedRows: Set<number>;
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
}

interface UseGridKeyboardResult {
  editingCell: EditingCell | null;
  editValue: string;
  setEditValue: React.Dispatch<React.SetStateAction<string>>;
  handleCopySelection: () => void;
  handlePaste: () => Promise<void>;
  handleStartEdit: (rowIndex: number, columnId: string, currentValue: string | null) => void;
  handleConfirmEdit: () => void;
  handleCancelEdit: () => void;
}

export function useGridKeyboard({
  isEditMode,
  selectedRows,
  columns,
  rowData,
  tableContainerRef,
  updateCell,
  onDeleteRow,
}: UseGridKeyboardOptions): UseGridKeyboardResult {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const handleCopySelection = useCallback(() => {
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
    navigator.clipboard.writeText(tsv);
  }, [selectedRows, columns, rowData]);

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

  const handleConfirmEdit = useCallback(() => {
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tableContainerRef.current?.contains(document.activeElement)) return;

      // If editing a cell, handle Enter/Escape
      if (editingCell) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleConfirmEdit();
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isEditMode,
    editingCell,
    selectedRows,
    columns,
    rowData,
    tableContainerRef,
    handleCopySelection,
    handlePaste,
    onDeleteRow,
    handleStartEdit,
    handleConfirmEdit,
    handleCancelEdit,
  ]);

  return {
    editingCell,
    editValue,
    setEditValue,
    handleCopySelection,
    handlePaste,
    handleStartEdit,
    handleConfirmEdit,
    handleCancelEdit,
  };
}
