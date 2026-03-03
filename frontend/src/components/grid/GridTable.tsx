import { flexRender, type Row, type Table } from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { memo, type RefObject } from 'react';
import type { RowData } from '../../types/grid';
import styles from './ResultGrid.module.css';

export interface GridEditContext {
  isEditMode: boolean;
  editingCell: { rowIndex: number; columnId: string } | null;
  editValue: string;
  /** Row-level checkers */
  isRowDeleted: (index: number) => boolean;
  isRowInserted: (index: number) => boolean;
  /** Cell-level checkers */
  getCellChange: (index: number, field: string) => unknown;
  isForeignKeyColumn: (field: string) => boolean;
}

export interface GridSelectionState {
  selectedRows: Set<number>;
  selectedColumn: string | null;
}

interface GridTableCallbacks {
  onSetEditValue: (value: string) => void;
  onStartEdit: (originalIndex: number, field: string, value: string | null) => void;
  onConfirmEdit: () => void;
  onRowClick: (rowIndex: number) => void;
  onCellClick: (rowIndex: number, field: string) => void;
}

interface GridTableProps {
  table: Table<RowData>;
  tableContainerRef: RefObject<HTMLDivElement | null>;
  rows: Row<RowData>[];
  virtualRows: VirtualItem[];
  totalSize: number;
  showColumnFilters: boolean;
  showLogicalNamesInGrid: boolean;
  edit: GridEditContext;
  selection: GridSelectionState;
  callbacks: GridTableCallbacks;
}

function GridTableInner({
  table,
  tableContainerRef,
  rows,
  virtualRows,
  totalSize,
  showColumnFilters,
  showLogicalNamesInGrid,
  edit,
  selection,
  callbacks,
}: GridTableProps) {
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <div ref={tableContainerRef} className={styles.tableContainer}>
      <table key={`table-${showLogicalNamesInGrid}`} className={styles.table}>
        <thead className={styles.thead}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className={styles.theadRow}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDirection = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={[styles.th, canSort && styles.sortable].filter(Boolean).join(' ')}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                    }}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <div className={styles.thContent}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortDirection && (
                        <span className={styles.sortIndicator}>
                          {sortDirection === 'asc' ? ' \u25B2' : ' \u25BC'}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
          {showColumnFilters && (
            <tr className={styles.filterRow}>
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th key={`filter-${header.id}`} className={styles.filterCell}>
                  <input
                    type="text"
                    className={styles.columnFilterInput}
                    placeholder="..."
                    value={(header.column.getFilterValue() as string) ?? ''}
                    onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                  />
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody className={styles.tbody}>
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: `${paddingTop}px` }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const rowIndex = virtualRow.index;
            const originalIndex = Number(row.original.__originalIndex);
            const isSelected = selection.selectedRows.has(rowIndex);
            const isDeleted = edit.isRowDeleted(originalIndex);
            const isInserted = edit.isRowInserted(originalIndex);

            const rowClasses = [
              styles.tbodyRow,
              isSelected && styles.selected,
              isDeleted && styles.deleted,
              isInserted && styles.inserted,
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr
                key={row.id}
                className={rowClasses}
                onClick={() => callbacks.onRowClick(rowIndex)}
              >
                {row.getVisibleCells().map((cell) => {
                  const value = cell.getValue();
                  const field = cell.column.id;
                  const change =
                    field !== '__rowIndex' && field !== '__originalIndex'
                      ? edit.getCellChange(originalIndex, field)
                      : null;
                  const isChanged = change !== null;
                  const isNull = value === null;
                  const align = (cell.column.columnDef.meta as { align?: string })?.align ?? 'left';
                  const isEditing =
                    edit.editingCell?.rowIndex === originalIndex &&
                    edit.editingCell?.columnId === field;
                  const isEditable =
                    edit.isEditMode && field !== '__rowIndex' && field !== '__originalIndex';
                  const isFk = edit.isForeignKeyColumn(field);
                  const isCellSelected = isSelected && selection.selectedColumn === field;

                  const cellClasses = [
                    styles.td,
                    isNull && styles.nullCell,
                    isChanged && styles.changedCell,
                    isFk && styles.fkCell,
                    isCellSelected && styles.selectedCell,
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <td
                      key={cell.id}
                      className={cellClasses}
                      style={{
                        width: cell.column.getSize(),
                        textAlign: isNull ? 'center' : (align as 'left' | 'right' | 'center'),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        callbacks.onCellClick(rowIndex, field);
                      }}
                      onDoubleClick={() => {
                        if (isEditable) {
                          callbacks.onStartEdit(originalIndex, field, value as string | null);
                        }
                      }}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          className={styles.cellInput}
                          value={edit.editValue}
                          onChange={(e) => callbacks.onSetEditValue(e.target.value)}
                          onBlur={callbacks.onConfirmEdit}
                          autoFocus
                        />
                      ) : isNull ? (
                        'NULL'
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr>
              <td style={{ height: `${paddingBottom}px` }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const GridTable = memo(GridTableInner);
