import { flexRender, type Row, type Table } from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { type MouseEvent, memo, type RefObject, type UIEvent, useCallback, useMemo } from 'react';
import { type ColumnMeta, isSystemColumn, type RowData } from '../../types/grid';
import type { ValidationError } from '../../utils/validation';
import { ContextMenu } from '../common/ContextMenu';
import { ColumnResizer } from './ColumnResizer';
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
  getValidationError: (index: number, field: string) => ValidationError | null;
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
  /**
   * 列幅 state。`table` 参照は state 変化でも同一 (TanStack 仕様) のため、
   * memo の浅い比較で列幅変化を検出するには明示的に props として受け取る必要がある。
   */
  columnSizing: Record<string, number>;
  /** Table name embedded in INSERT copy (sourceTable for data-view tabs, undefined for arbitrary SQL) */
  tableName?: string;
  /** Scroll 位置保存のためのハンドラ (ResultGrid 側で store 更新) */
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  /** 指定列のみ列幅オートアジャスト (Issue #387) */
  onAutoSizeColumn?: (columnId: string) => void;
  /** 全列を列幅オートアジャスト (Issue #387) */
  onAutoSizeColumns?: () => void;
}

// Issue #417: TanStack Virtual が `outerSize=0` (= 容器の offsetHeight=0) で
// `virtualRows=[]` を返した状態 (= "broken state") から復旧不能になる事象への
// フォールバック上限。WebView2 想定 (1080p / 行高 32px) で可視 ~33 行、
// overscan 10 を含めた約 1.5 倍を確保し、初回描画コストとのバランスを取った値。
// virtualizer が ResizeObserver 経由で復旧し次第、通常経路に戻る (本フォールバックは無効化)。
const FALLBACK_RENDER_LIMIT = 50;
// 仮想行 fallback で使う既定行高 (= ResultGrid の estimateSize と一致させる)。
const FALLBACK_ROW_HEIGHT = 32;

/** broken-state 用に合成 VirtualItem 配列を生成する (純粋関数) */
function createFallbackVirtualItems(rowCount: number): VirtualItem[] {
  const limit = Math.min(rowCount, FALLBACK_RENDER_LIMIT);
  const items: VirtualItem[] = new Array(limit);
  for (let i = 0; i < limit; i++) {
    items[i] = {
      key: i,
      index: i,
      start: i * FALLBACK_ROW_HEIGHT,
      end: (i + 1) * FALLBACK_ROW_HEIGHT,
      size: FALLBACK_ROW_HEIGHT,
      lane: 0,
    };
  }
  return items;
}

/** virtualRows 配列から paddingTop / paddingBottom を計算する (純粋関数) */
function computeRowPaddings(
  items: VirtualItem[],
  totalSize: number
): { paddingTop: number; paddingBottom: number } {
  if (items.length === 0) return { paddingTop: 0, paddingBottom: 0 };
  const paddingTop = items[0]?.start ?? 0;
  const lastEnd = items[items.length - 1]?.end ?? 0;
  // broken-state では totalSize も 0 になり得るため (totalSize - lastEnd) が負にならないようガード。
  const paddingBottom = Math.max(0, totalSize - lastEnd);
  return { paddingTop, paddingBottom };
}

/** Extract row/cell info from a bubbled event via data attributes */
function findCellFromEvent(e: MouseEvent) {
  const td = (e.target as HTMLElement).closest('td[data-field]') as HTMLElement | null;
  if (!td) return null;
  const tr = td.closest('tr[data-row-index]') as HTMLElement | null;
  if (!tr) return null;
  const field = td.dataset.field;
  const rowIndexStr = tr.dataset.rowIndex;
  const originalIndexStr = tr.dataset.originalIndex;
  if (!field || rowIndexStr == null || originalIndexStr == null) return null;
  return { field, rowIndex: Number(rowIndexStr), originalIndex: Number(originalIndexStr) };
}

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
  tableName,
  onScroll,
  onAutoSizeColumn,
  onAutoSizeColumns,
  // memo の浅い比較で列幅変化を検出するために受け取るだけ。値自体は table.getState() 経由で参照される。
  columnSizing: _columnSizing,
}: GridTableProps) {
  // Issue #417: virtualizer broken-state (rows>0 だが virtualRows=[]) を検出して
  // 先頭 N 行を非仮想で描画する。これにより WebView2 layout race で空表示になる
  // 事象を回避する。virtualizer が復旧した瞬間 (virtualRows が満たされた瞬間)
  // 通常経路に切り替わるため、復旧後の二重描画は起こらない。
  const isVirtualizerBroken = virtualRows.length === 0 && rows.length > 0;
  const renderItems = useMemo<VirtualItem[]>(
    () => (isVirtualizerBroken ? createFallbackVirtualItems(rows.length) : virtualRows),
    [isVirtualizerBroken, virtualRows, rows.length]
  );

  const { paddingTop, paddingBottom } = computeRowPaddings(renderItems, totalSize);

  const { contextMenu, openHeaderMenu, openCellMenu, closeMenu, getMenuItems } = useGridContextMenu(
    columnsMeta,
    rows,
    table,
    {
      isEditMode: edit.isEditMode,
      updateCell: callbacks.onUpdateCell,
      tableName,
      onAutoSizeColumn,
      onAutoSizeColumns,
    }
  );

  // Move focus into the table container on click so global keyboard handlers
  // (useKeyboardHandler gates by containerRef.contains(activeElement)) can
  // receive Ctrl+C etc. Without this, the browser's default text selection
  // copies only the last clicked cell. Also suppresses the default Shift+click
  // text-range selection which would otherwise conflict with grid selection.
  const onContainerMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.shiftKey) e.preventDefault();
      tableContainerRef.current?.focus({ preventScroll: true });
    },
    [tableContainerRef]
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: scroll/focus container for the inner table; keyboard navigation is handled at table-cell level
    <div
      ref={tableContainerRef}
      className={styles.tableContainer}
      tabIndex={-1}
      onMouseDown={onContainerMouseDown}
      onScroll={onScroll}
    >
      <table
        key={`table-${showLogicalNamesInGrid}`}
        className={styles.table}
        style={{
          // inline style で table-layout/width を強制 (#368)。
          // CSS Modules scoping や specificity 由来の適用漏れを排除する。
          tableLayout: 'fixed',
          width:
            table.getHeaderGroups()[0]?.headers.reduce((sum, h) => sum + h.getSize(), 0) ?? 'auto',
        }}
      >
        {/* colgroup で列幅を明示的に固定 (#368)。table-layout: fixed の参照元として
            最も信頼性が高く、virtualization の spacer <tr> の影響を受けない */}
        <colgroup>
          {table.getHeaderGroups()[0]?.headers.map((header) => (
            <col key={header.id} style={{ width: header.getSize() }} />
          ))}
        </colgroup>
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
                    {header.column.getCanResize() && (
                      <ColumnResizer
                        columnId={header.column.id}
                        currentWidth={header.getSize()}
                        minWidth={header.column.columnDef.minSize}
                        maxWidth={header.column.columnDef.maxSize}
                        onResizeCommit={(id, w) =>
                          table.setColumnSizing((prev) => ({ ...prev, [id]: w }))
                        }
                        onAutoSizeColumn={onAutoSizeColumn}
                      />
                    )}
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
                    value={String(header.column.getFilterValue() ?? '')}
                    onChange={(e) => header.column.setFilterValue(e.target.value || undefined)}
                  />
                </th>
              ))}
            </tr>
          )}
        </thead>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: cell-level keyboard navigation is handled by useKeyboardHandler at the container level */}
        <tbody
          className={styles.tbody}
          onClick={(e) => {
            const info = findCellFromEvent(e);
            if (!info) return;
            const { field, rowIndex } = info;
            if (isSystemColumn(field)) {
              e.shiftKey ? callbacks.onRowRangeSelect(rowIndex) : callbacks.onRowToggle(rowIndex);
            } else {
              e.shiftKey
                ? callbacks.onCellRangeSelect(rowIndex, field)
                : callbacks.onCellClick(rowIndex, field);
            }
          }}
          onContextMenu={(e) => {
            const info = findCellFromEvent(e);
            if (!info) return;
            openCellMenu(e, info.rowIndex, info.field);
          }}
          onDoubleClick={(e) => {
            if (!edit.isEditMode) return;
            const info = findCellFromEvent(e);
            if (!info) return;
            const { field, rowIndex, originalIndex } = info;
            if (isSystemColumn(field)) return;
            const row = rows[rowIndex];
            if (!row) return;
            const value = row.getValue(field);
            callbacks.onStartEdit(originalIndex, field, typeof value === 'string' ? value : null);
          }}
        >
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: `${paddingTop}px` }} />
            </tr>
          )}
          {renderItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
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
                data-row-index={rowIndex}
                data-original-index={originalIndex}
              >
                {row.getVisibleCells().map((cell) => {
                  const value = cell.getValue();
                  const field = cell.column.id;
                  const change = !isSystemColumn(field)
                    ? edit.getCellChange(originalIndex, field)
                    : null;
                  const isChanged = change !== null;
                  const isNull = value === null;
                  const align = cell.column.columnDef.meta?.align ?? 'left';
                  const isEditing =
                    edit.editingCell?.rowIndex === originalIndex &&
                    edit.editingCell?.columnId === field;
                  const validationError = !isSystemColumn(field)
                    ? edit.getValidationError(originalIndex, field)
                    : null;
                  const hasValidationError = validationError !== null;
                  const isFk = edit.isForeignKeyColumn(field);
                  const isCellSelected =
                    isSelected && selection.selectedColumns.has(field) && !isSystemColumn(field);

                  const cellClasses = [
                    styles.td,
                    isNull && styles.nullCell,
                    isChanged && styles.changedCell,
                    hasValidationError && styles.validationErrorCell,
                    isFk && styles.fkCell,
                    isCellSelected && styles.selectedCell,
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <td
                      key={cell.id}
                      className={cellClasses}
                      title={validationError?.message}
                      style={{
                        width: cell.column.getSize(),
                        textAlign: isNull ? 'center' : align,
                      }}
                      data-field={field}
                    >
                      {isEditing ? (
                        <input
                          ref={(el) => {
                            el?.focus();
                          }}
                          type="text"
                          className={styles.cellInput}
                          value={edit.editValue}
                          onChange={(e) => callbacks.onSetEditValue(e.target.value)}
                          onBlur={callbacks.onCommitEdit}
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
