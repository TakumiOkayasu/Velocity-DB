import { useCallback, useMemo, useRef, useState } from 'react';
import { isSystemColumn } from '../../../types/grid';

export function useGridSelection(
  rowsLengthRef: React.RefObject<number>,
  columnOrderRef: React.RefObject<string[]>
) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const lastClickedRowRef = useRef<number | null>(null);
  const lastClickedColumnRef = useRef<string | null>(null);

  const toggleRow = useCallback((rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
    lastClickedRowRef.current = rowIndex;
    setSelectedColumns(new Set());
  }, []);

  const rangeSelectRow = useCallback((rowIndex: number) => {
    if (lastClickedRowRef.current === null) return;
    const start = Math.min(lastClickedRowRef.current, rowIndex);
    const end = Math.max(lastClickedRowRef.current, rowIndex);
    const range = new Set<number>();
    for (let i = start; i <= end; i++) range.add(i);
    setSelectedRows(range);
    setSelectedColumns(new Set());
  }, []);

  const selectCell = useCallback((rowIndex: number, field: string) => {
    if (isSystemColumn(field)) return;
    setSelectedRows(new Set([rowIndex]));
    setSelectedColumns(new Set([field]));
    lastClickedRowRef.current = rowIndex;
    lastClickedColumnRef.current = field;
  }, []);

  const rangeCellSelect = useCallback(
    (rowIndex: number, field: string) => {
      if (isSystemColumn(field)) return;
      if (lastClickedRowRef.current === null || lastClickedColumnRef.current === null) {
        selectCell(rowIndex, field);
        return;
      }
      const allColumnIds = columnOrderRef.current;
      const anchorColIdx = allColumnIds.indexOf(lastClickedColumnRef.current);
      const targetColIdx = allColumnIds.indexOf(field);
      if (anchorColIdx === -1 || targetColIdx === -1) {
        selectCell(rowIndex, field);
        return;
      }
      const rowStart = Math.min(lastClickedRowRef.current, rowIndex);
      const rowEnd = Math.max(lastClickedRowRef.current, rowIndex);
      const rowRange = new Set<number>();
      for (let i = rowStart; i <= rowEnd; i++) rowRange.add(i);

      const [colFrom, colTo] =
        anchorColIdx < targetColIdx ? [anchorColIdx, targetColIdx] : [targetColIdx, anchorColIdx];
      const colRange = new Set(
        allColumnIds.slice(colFrom, colTo + 1).filter((id) => !isSystemColumn(id))
      );
      if (colRange.size === 0) {
        selectCell(rowIndex, field);
        return;
      }

      setSelectedRows(rowRange);
      setSelectedColumns(colRange);
    },
    [selectCell, columnOrderRef]
  );

  const selectAllRows = useCallback(() => {
    const count = rowsLengthRef.current;
    setSelectedRows((prev) => {
      if (prev.size === count) return prev;
      const allRows = new Set<number>();
      for (let i = 0; i < count; i++) allRows.add(i);
      return allRows;
    });
    setSelectedColumns(new Set());
  }, [rowsLengthRef]);

  const selectColumn = useCallback(
    (columnId: string) => {
      selectAllRows();
      setSelectedColumns(new Set([columnId]));
      lastClickedRowRef.current = null;
      lastClickedColumnRef.current = columnId;
    },
    [selectAllRows]
  );

  const rangeSelectColumn = useCallback(
    (columnId: string) => {
      if (!lastClickedColumnRef.current) return;
      const allColumnIds = columnOrderRef.current;
      const startIdx = allColumnIds.indexOf(lastClickedColumnRef.current);
      const endIdx = allColumnIds.indexOf(columnId);
      if (startIdx === -1 || endIdx === -1) return;
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      selectAllRows();
      setSelectedColumns(new Set(allColumnIds.slice(from, to + 1)));
      lastClickedRowRef.current = null;
    },
    [columnOrderRef, selectAllRows]
  );

  const selectionState = useMemo(
    () => ({ selectedRows, selectedColumns }),
    [selectedRows, selectedColumns]
  );

  const resetSelection = useCallback(() => {
    setSelectedRows(new Set());
    setSelectedColumns(new Set());
  }, []);

  return {
    selectedRows,
    selectedColumns,
    selectionState,
    toggleRow,
    rangeSelectRow,
    selectCell,
    rangeCellSelect,
    selectColumn,
    rangeSelectColumn,
    selectAllRows,
    resetSelection,
  };
}
