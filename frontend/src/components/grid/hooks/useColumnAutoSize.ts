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

// SQL Server type keywords (partial match for types like "int identity")
const NUMERIC_TYPE_KEYWORDS = [
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'real',
  'money',
  'smallmoney',
  'bit',
] as const;

const DATE_TYPE_KEYWORDS = [
  'date',
  'datetime',
  'datetime2',
  'smalldatetime',
  'time',
  'datetimeoffset',
] as const;

function isNumericType(type: string): boolean {
  const lower = type.toLowerCase();
  return NUMERIC_TYPE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isDateType(type: string): boolean {
  const lower = type.toLowerCase();
  return DATE_TYPE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// Text measurement using canvas (Electron-only, no SSR concerns)
function createMeasureContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
}

let cachedContext: CanvasRenderingContext2D | null = null;

function measureTextWidth(text: string, font: string): number {
  if (!cachedContext) {
    cachedContext = createMeasureContext();
  }
  if (!cachedContext) return 0;
  cachedContext.font = font;
  return cachedContext.measureText(text).width;
}

interface ColumnSizeConfig {
  minWidth: number;
  maxWidth: number;
  padding: number;
}

function getColumnConfig(columnType: string | undefined): ColumnSizeConfig {
  if (!columnType) {
    return { minWidth: 60, maxWidth: 300, padding: 16 };
  }

  if (isNumericType(columnType)) {
    return { minWidth: 40, maxWidth: 150, padding: 12 };
  }

  if (isDateType(columnType)) {
    return { minWidth: 80, maxWidth: 200, padding: 12 };
  }

  // Text/varchar types
  return { minWidth: 60, maxWidth: 400, padding: 16 };
}

const FONT = '13px system-ui, sans-serif';
const HEADER_FONT = '600 13px system-ui, sans-serif';
const ROW_INDEX_CONFIG = { minWidth: 36, maxWidth: 80, padding: 8 };

function calculateColumnSizing(
  columns: ColumnDef<RowData>[],
  rowData: RowData[],
  resultSet: ResultSet
): Record<string, number> {
  const sizing: Record<string, number> = {};
  const columnTypeMap = new Map(resultSet.columns.map((c) => [c.name, c.type]));

  for (const col of columns) {
    const columnId = String(col.id);
    const isRowIndex = columnId === '__rowIndex';

    const config = isRowIndex ? ROW_INDEX_CONFIG : getColumnConfig(columnTypeMap.get(columnId));

    // Measure header width
    const headerText = String(col.header || '');
    const headerWidth = measureTextWidth(headerText, HEADER_FONT);

    // Measure content width (sample up to 100 rows for performance)
    let contentMaxWidth = 0;
    const sampleSize = Math.min(rowData.length, 100);
    for (let i = 0; i < sampleSize; i++) {
      const value = rowData[i][columnId];
      const text = value === null ? 'NULL' : String(value);
      const width = measureTextWidth(text, FONT);
      contentMaxWidth = Math.max(contentMaxWidth, width);
    }

    // Calculate final width: max of header/content + padding, clamped to min/max
    const contentWidth = Math.max(headerWidth, contentMaxWidth) + config.padding;
    sizing[columnId] = Math.min(config.maxWidth, Math.max(config.minWidth, contentWidth));
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

    const newSizing = calculateColumnSizing(columns, rowData, resultSet);
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
