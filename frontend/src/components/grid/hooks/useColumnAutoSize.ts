import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResultSet } from '../../../types';
import { log } from '../../../utils/logger';

type RowData = Record<string, string | null>;

interface UseColumnAutoSizeOptions {
  resultSet: ResultSet | null;
  columns: ColumnDef<RowData>[];
  rowData: RowData[];
}

interface UseColumnAutoSizeResult {
  columnSizing: Record<string, number>;
  setColumnSizing: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}

const COLUMN_CONFIG = {
  paddingDefault: 40,
  paddingRowIndex: 24,
  headerExtraSpace: 16,
  minWidthDefault: 80,
  minWidthRowIndex: 40,
  maxWidth: 600,
  sampleSize: 1000,
  font: '14px monospace',
  headerFont: 'bold 14px monospace',
} as const;

function measureTextWidth(text: string, font: string): number {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.font = font;
  return context.measureText(text).width;
}

function calculateColumnSizing(
  columns: ColumnDef<RowData>[],
  rowData: RowData[]
): Record<string, number> {
  const sizing: Record<string, number> = {};

  for (const col of columns) {
    const columnId = String(col.id);
    const isRowIndex = columnId === '__rowIndex';
    const minWidth = isRowIndex ? COLUMN_CONFIG.minWidthRowIndex : COLUMN_CONFIG.minWidthDefault;
    const padding = isRowIndex ? COLUMN_CONFIG.paddingRowIndex : COLUMN_CONFIG.paddingDefault;

    const headerText = String(col.header || '');
    const headerWidth =
      measureTextWidth(headerText, COLUMN_CONFIG.headerFont) + COLUMN_CONFIG.headerExtraSpace;

    let contentMaxWidth = 0;
    const sampleSize = Math.min(rowData.length, COLUMN_CONFIG.sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      const value = rowData[i][columnId];
      const text = value === null ? 'NULL' : String(value);
      const width = measureTextWidth(text, COLUMN_CONFIG.font);
      contentMaxWidth = Math.max(contentMaxWidth, width);
    }

    const maxMeasured = Math.max(headerWidth, contentMaxWidth);
    sizing[columnId] = Math.min(COLUMN_CONFIG.maxWidth, Math.max(minWidth, maxMeasured + padding));
  }

  return sizing;
}

export function useColumnAutoSize({
  resultSet,
  columns,
  rowData,
}: UseColumnAutoSizeOptions): UseColumnAutoSizeResult {
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
  const prevColumnsRef = useRef<string | null>(null);

  const applyAutoSize = useCallback(() => {
    if (!resultSet || rowData.length === 0) {
      log.debug('[useColumnAutoSize] No data to auto-size');
      return;
    }

    const newSizing = calculateColumnSizing(columns, rowData);
    setColumnSizing(newSizing);
    log.debug(`[useColumnAutoSize] Auto-sized: ${JSON.stringify(newSizing)}`);
  }, [resultSet, columns, rowData]);

  useEffect(() => {
    const columnsKey = resultSet?.columns.map((c) => c.name).join(',') ?? null;

    if (columnsKey !== prevColumnsRef.current && rowData.length > 0) {
      prevColumnsRef.current = columnsKey;
      applyAutoSize();
    }
  }, [resultSet?.columns, rowData.length, applyAutoSize]);

  return { columnSizing, setColumnSizing };
}
