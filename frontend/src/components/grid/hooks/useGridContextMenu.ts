import type { Row, Table } from '@tanstack/react-table';
import { useCallback, useRef, useState } from 'react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { ColumnMeta, RowData } from '../../../types/grid';
import type { ContextMenuItem } from '../../common/ContextMenu';

type ContextMenuState =
  | { x: number; y: number; type: 'header'; columnId: string }
  | { x: number; y: number; type: 'cell'; columnId: string; rowIndex: number };

export function useGridContextMenu(
  columnsMeta: ColumnMeta[],
  rows: Row<RowData>[],
  table: Table<RowData>
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const copyToClipboard = useCopyToClipboard();
  const prevRowsRef = useRef(rows);

  if (prevRowsRef.current !== rows) {
    prevRowsRef.current = rows;
    if (contextMenu) setContextMenu(null);
  }

  const handleHeaderContextMenu = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'header', columnId });
  }, []);

  const handleCellContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number, columnId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'cell', columnId, rowIndex });
    },
    []
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
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

    const row = rows[contextMenu.rowIndex];
    const cellValue = row ? String(row.original[contextMenu.columnId] ?? 'NULL') : '';

    return [
      {
        label: 'セル値をコピー',
        action: () => copyToClipboard(cellValue, 'セル値をコピーしました'),
      },
      {
        label: '行をコピー',
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
      {
        label: '列をコピー',
        action: () => {
          const colData = rows.map((r) => {
            const v = r.original[contextMenu.columnId];
            return v === null || v === undefined ? 'NULL' : String(v);
          });
          copyToClipboard(colData.join('\n'), '列データをコピーしました');
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'この値でフィルタ',
        action: () => {},
        disabled: true,
      },
    ];
  }, [contextMenu, columnsMeta, rows, table, copyToClipboard]);

  return {
    contextMenu,
    handleHeaderContextMenu,
    handleCellContextMenu,
    closeContextMenu,
    getContextMenuItems,
  };
}
