import { useCallback, useRef, useState } from 'react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { ColumnMeta, RowData } from '../../../types/grid';
import type { ContextMenuItem } from '../../common/ContextMenu';

/** Row から実際に使用するプロパティのみを要求 (ISP) */
export interface GridRow {
  original: RowData;
}

/** Table から実際に使用するプロパティのみを要求 (ISP) */
export interface GridTable {
  getColumn: (id: string) => { toggleSorting: (desc: boolean) => void } | undefined;
}

/** MouseEvent から実際に使用するプロパティのみを要求 (ISP) */
export interface GridMouseEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
}

const DEFAULT_TABLE_PLACEHOLDER = 'table_name';
// 識別子として安全な文字のみ許可 (英数/_/./角括弧/バッククォート/ダブルクォート/空白/$/-)
const SAFE_IDENT_PATTERN = /^[\w.[\]"` $-]+$/;

function resolveTargetTable(tableName: string | undefined): string {
  if (!tableName || tableName.length === 0) return DEFAULT_TABLE_PLACEHOLDER;
  return SAFE_IDENT_PATTERN.test(tableName) ? tableName : DEFAULT_TABLE_PLACEHOLDER;
}

function escapeSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'`;
}

/** INSERT SQL 生成 (純粋関数、単体テスト可能) */
export function buildInsertSql(
  tableName: string | undefined,
  columnNames: readonly string[],
  row: RowData
): string {
  const target = resolveTargetTable(tableName);
  const values = columnNames.map((c) => escapeSqlLiteral(row[c]));
  return `INSERT INTO ${target} (${columnNames.join(', ')}) VALUES (${values.join(', ')});`;
}

type ContextMenuState =
  | { x: number; y: number; type: 'header'; columnId: string }
  | { x: number; y: number; type: 'cell'; columnId: string; rowIndex: number };

interface UseGridContextMenuOptions {
  isEditMode: boolean;
  updateCell?: (
    rowIndex: number,
    field: string,
    oldValue: string | null,
    newValue: string | null
  ) => void;
  /** INSERT文に埋め込むテーブル名。未指定時は `table_name` プレースホルダ */
  tableName?: string;
}

export function useGridContextMenu(
  columnsMeta: ColumnMeta[],
  rows: GridRow[],
  table: GridTable,
  { isEditMode = false, updateCell, tableName }: UseGridContextMenuOptions = { isEditMode: false }
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const copyToClipboard = useCopyToClipboard();
  const prevRowsRef = useRef(rows);

  if (prevRowsRef.current !== rows) {
    prevRowsRef.current = rows;
    if (contextMenu) setContextMenu(null);
  }

  const openHeaderMenu = useCallback((e: GridMouseEvent, columnId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'header', columnId });
  }, []);

  const openCellMenu = useCallback((e: GridMouseEvent, rowIndex: number, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'cell', columnId, rowIndex });
  }, []);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const getMenuItems = useCallback((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const col = columnsMeta.find((c) => c.name === contextMenu.columnId);

    if (contextMenu.type === 'header') {
      const items: ContextMenuItem[] = [
        {
          label: 'カラム名をコピー',
          action: () => copyToClipboard(contextMenu.columnId, 'カラム名をコピーしました'),
        },
      ];
      if (col?.comment) {
        items.push({
          label: '論理名をコピー',
          action: () => copyToClipboard(col.comment, '論理名をコピーしました'),
        });
      }

      items.push({ label: '', action: () => {}, separator: true });

      items.push({
        label: '列値をすべてコピー',
        action: () => {
          const colData = rows.map((r) => {
            const v = r.original[contextMenu.columnId];
            return v === null || v === undefined ? 'NULL' : String(v);
          });
          copyToClipboard(colData.join('\n'), '列データをコピーしました');
        },
      });
      items.push({
        label: '列値をコピー（ヘッダー付き）',
        action: () => {
          const header = contextMenu.columnId;
          const colData = rows.map((r) => {
            const v = r.original[contextMenu.columnId];
            return v === null || v === undefined ? 'NULL' : String(v);
          });
          copyToClipboard([header, ...colData].join('\n'), '列データをコピーしました');
        },
      });

      items.push({ label: '', action: () => {}, separator: true });

      const column = table.getColumn(contextMenu.columnId);
      items.push({
        label: '昇順でソート',
        action: () => column?.toggleSorting(false),
      });
      items.push({
        label: '降順でソート',
        action: () => column?.toggleSorting(true),
      });
      return items;
    }

    // Cell context menu
    const row = rows[contextMenu.rowIndex];
    if (!row) return [];
    const cellValue = String(row.original[contextMenu.columnId] ?? 'NULL');
    const originalIndex = Number(row.original.__originalIndex);

    const items: ContextMenuItem[] = [
      {
        label: 'セル値をコピー',
        action: () => copyToClipboard(cellValue, 'セル値をコピーしました'),
      },
      {
        label: '行をコピー（ヘッダー付き）',
        action: () => {
          const headerRow = columnsMeta.map((c) => c.name);
          const dataRow = columnsMeta.map((c) => {
            const v = row?.original[c.name];
            return v === null || v === undefined ? 'NULL' : String(v);
          });
          copyToClipboard(
            [headerRow.join('\t'), dataRow.join('\t')].join('\n'),
            '行をコピーしました'
          );
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'SQL INSERTとしてコピー',
        action: () => {
          if (!row) return;
          const colNames = columnsMeta.map((c) => c.name);
          const sql = buildInsertSql(tableName, colNames, row.original);
          copyToClipboard(sql, 'SQL INSERTをコピーしました');
        },
      },
    ];

    // NULL設定 (edit mode only)
    if (isEditMode && updateCell) {
      items.push({ label: '', action: () => {}, separator: true });
      items.push({
        label: 'NULLに設定',
        action: () => {
          const oldValue = row?.original[contextMenu.columnId] ?? null;
          if (oldValue !== null) {
            updateCell(originalIndex, contextMenu.columnId, oldValue, null);
          }
        },
      });
    }

    items.push({ label: '', action: () => {}, separator: true });
    items.push({
      label: 'この値でフィルタ',
      action: () => {},
      disabled: true,
    });

    return items;
  }, [contextMenu, columnsMeta, rows, table, copyToClipboard, isEditMode, updateCell, tableName]);

  return {
    contextMenu,
    openHeaderMenu,
    openCellMenu,
    closeMenu,
    getMenuItems,
  };
}
