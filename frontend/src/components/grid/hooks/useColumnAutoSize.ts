import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useRef, useState } from 'react';
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

// CSS already has cell padding (12px horizontal), so JS padding is minimal
function getColumnConfig(columnType: string | undefined): ColumnSizeConfig {
  if (!columnType) {
    return { minWidth: 50, maxWidth: 250, padding: 8 };
  }

  if (isNumericType(columnType)) {
    return { minWidth: 36, maxWidth: 120, padding: 4 };
  }

  if (isDateType(columnType)) {
    return { minWidth: 60, maxWidth: 180, padding: 4 };
  }

  // Text/varchar types
  return { minWidth: 50, maxWidth: 300, padding: 8 };
}

const FONT = '13px monospace';
const HEADER_FONT = '600 13px system-ui, sans-serif';
const ROW_INDEX_CONFIG = { minWidth: 32, maxWidth: 60, padding: 4 };

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

// Generate a stable key for column structure (name + type)
function getColumnsKey(resultSet: ResultSet | null): string | null {
  if (!resultSet) return null;
  return resultSet.columns.map((c) => `${c.name}:${c.type}`).join(',');
}

export function useColumnAutoSize({
  resultSet,
  columns,
  rowData,
}: UseColumnAutoSizeOptions): UseColumnAutoSizeResult {
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
  const appliedKeyRef = useRef<string | null>(null);

  // Keep latest values in refs for stable effect
  const columnsRef = useRef(columns);
  const rowDataRef = useRef(rowData);
  columnsRef.current = columns;
  rowDataRef.current = rowData;

  // Auto-size only when column structure changes (new query result)
  useEffect(() => {
    if (!resultSet || rowDataRef.current.length === 0) return;

    const columnsKey = getColumnsKey(resultSet);
    if (columnsKey === appliedKeyRef.current) return;

    appliedKeyRef.current = columnsKey;
    const newSizing = calculateColumnSizing(columnsRef.current, rowDataRef.current, resultSet);
    setColumnSizing(newSizing);
    log.debug(`[useColumnAutoSize] Auto-sized for key: ${columnsKey}`);
  }, [resultSet]);

  return { columnSizing, setColumnSizing };
}
