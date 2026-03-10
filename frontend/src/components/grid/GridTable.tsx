import { flexRender, type Row, type Table } from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { type MouseEvent, memo, type RefObject } from 'react';
import { type ColumnMeta, isSystemColumn, type RowData } from '../../types/grid';
import { ContextMenu } from '../common/ContextMenu';
import { useGridContextMenu } from './hooks/useGridContextMenu';
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
  selectedColumns: Set<string>;
}

interface GridTableCallbacks {
  onSetEditValue: (value: string) => void;
  onStartEdit: (originalIndex: number, field: string, value: string | null) => void;
  onCommitEdit: () => void;
  onRowToggle: (rowIndex: number) => void;
  onRowRangeSelect: (rowIndex: number) => void;
  onCellClick: (rowIndex: number, field: string) => void;
  onCellRangeSelect: (rowIndex: number, field: string) => void;
  onColumnSelect: (columnId: string) => void;
  onColumnRangeSelect: (columnId: string) => void;
  onUpdateCell?: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
}

interface GridTableProps {
  table: Table<RowData>;
  tableContainerRef: RefObject<HTMLDivElement | null>;
  rows: Row<RowData>[];
  virtualRows: VirtualItem[];
  totalSize: number;
  showColumnFilters: boolean;
  showLogicalNamesInGrid: boolean;
  columnsMeta: ColumnMeta[];
  edit: GridEditContext;
  selection: GridSelectionState;
  callbacks: GridTableCallbacks;
}

const preventShiftSelect = (e: MouseEvent) => {
  if (e.shiftKey) e.preventDefault();
};

function GridTableInner({
  table,
  tableContainerRef,
  rows,
  virtualRows,
  totalSize,
  showColumnFilters,
  showLogicalNamesInGrid,
  columnsMeta,
  edit,
  selection,
  callbacks,
}: GridTableProps) {
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  const { contextMenu, openHeaderMenu, openCellMenu, closeMenu, getMenuItems } = useGridContextMenu(
    columnsMeta,
    rows,
    table,
    {
      isEditMode: edit.isEditMode,
      updateCell: callbacks.onUpdateCell,
    }
  );

  return (
    <div ref={tableContainerRef} className={styles.tableContainer} onMouseDown={preventShiftSelect}>
      <table key={`table-${showLogicalNamesInGrid}`} className={styles.table}>
        <thead className={styles.thead}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className={styles.theadRow}>
              {headerGroup.headers.map((header) => {
                const sortDirection = header.column.getIsSorted();
                const isColumnSelected = selection.selectedColumns.has(header.column.id);
                return (
                  <th
                    key={header.id}
                    className={[
                      styles.th,
                      styles.clickable,
                      isColumnSelected && styles.selectedColumnHeader,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                    }}
                    onClick={(e) =>
                      e.shiftKey
                        ? callbacks.onColumnRangeSelect(header.column.id)
                        : callbacks.onColumnSelect(header.column.id)
                    }
                    onContextMenu={(e) => openHeaderMenu(e, header.column.id)}
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
                onClick={(e) =>
                  e.shiftKey
                    ? callbacks.onRowRangeSelect(rowIndex)
                    : callbacks.onRowToggle(rowIndex)
                }
              >
                {row.getVisibleCells().map((cell) => {
                  const value = cell.getValue();
                  const field = cell.column.id;
                  const change = !isSystemColumn(field)
                    ? edit.getCellChange(originalIndex, field)
                    : null;
                  const isChanged = change !== null;
                  const isNull = value === null;
                  const align = (cell.column.columnDef.meta as { align?: string })?.align ?? 'left';
                  const isEditing =
                    edit.editingCell?.rowIndex === originalIndex &&
                    edit.editingCell?.columnId === field;
                  const isEditable = edit.isEditMode && !isSystemColumn(field);
                  const isFk = edit.isForeignKeyColumn(field);
                  const isCellSelected =
                    isSelected && selection.selectedColumns.has(field) && !isSystemColumn(field);

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
                        if (isSystemColumn(field)) {
                          e.shiftKey
                            ? callbacks.onRowRangeSelect(rowIndex)
                            : callbacks.onRowToggle(rowIndex);
                          return;
                        }
                        e.shiftKey
                          ? callbacks.onCellRangeSelect(rowIndex, field)
                          : callbacks.onCellClick(rowIndex, field);
                      }}
                      onContextMenu={(e) => openCellMenu(e, rowIndex, field)}
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
                          onBlur={callbacks.onCommitEdit}
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getMenuItems()}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

export const GridTable = memo(GridTableInner);
