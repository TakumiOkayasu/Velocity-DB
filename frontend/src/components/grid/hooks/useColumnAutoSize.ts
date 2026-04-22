import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ResultSet } from '../../../types';
import { isDateType, isNumericType, type RowData } from '../../../types/grid';
import { log } from '../../../utils/logger';

interface UseColumnAutoSizeOptions {
  resultSet: ResultSet | null;
  columns: ColumnDef<RowData>[];
  rowData: RowData[];
}

interface UseColumnAutoSizeResult {
  columnSizing: Record<string, number>;
  setColumnSizing: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  /** 全列を強制的に再計算する */
  triggerAutoSize: () => void;
  /** 指定列のみ再計算する (他列の現在幅は保持) */
  triggerAutoSizeForColumn: (columnId: string) => void;
}

function createMeasureContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
}

// font 別 context をキャッシュ (全行 × 列で measureText 大量発行、font 再設定コスト削減)
const contextByFont: Record<string, CanvasRenderingContext2D> = {};

function measureTextWidth(text: string, font: string): number {
  let ctx = contextByFont[font];
  if (!ctx) {
    const created = createMeasureContext();
    if (!created) return 0;
    created.font = font;
    contextByFont[font] = created;
    ctx = created;
  }
  return ctx.measureText(text).width;
}

interface ColumnSizeConfig {
  minWidth: number;
  maxWidth: number;
  padding: number;
}

function getColumnConfig(columnType: string | undefined): ColumnSizeConfig {
  if (!columnType) return { minWidth: 50, maxWidth: 250, padding: 8 };
  if (isNumericType(columnType)) return { minWidth: 36, maxWidth: 120, padding: 4 };
  if (isDateType(columnType)) return { minWidth: 60, maxWidth: 180, padding: 4 };
  return { minWidth: 50, maxWidth: 300, padding: 8 };
}

const FONT = '13px monospace';
const HEADER_FONT = '600 13px system-ui, sans-serif';
const ROW_INDEX_CONFIG: ColumnSizeConfig = { minWidth: 32, maxWidth: 60, padding: 4 };

// Issue #387: 原則は全行計測だが、超大規模データでメインスレッド長時間ブロックを避けるため
// 閾値超過時は先頭 SYNC_FULL_LIMIT 行にフォールバックする。
// 将来 requestIdleCallback 等で非同期化する場合はこのガードを撤去する。
const SYNC_FULL_LIMIT = 20000;

function resolveColumnConfig(columnId: string, resultSet: ResultSet): ColumnSizeConfig {
  if (columnId === '__rowIndex') return ROW_INDEX_CONFIG;
  const type = resultSet.columns.find((c) => c.name === columnId)?.type;
  return getColumnConfig(type);
}

function measureColumnWidth(
  columnId: string,
  headerText: string,
  rowData: RowData[],
  config: ColumnSizeConfig
): number {
  const headerWidth = measureTextWidth(headerText, HEADER_FONT);

  let contentMaxWidth = 0;
  const limit = rowData.length > SYNC_FULL_LIMIT ? SYNC_FULL_LIMIT : rowData.length;
  for (let i = 0; i < limit; i++) {
    const value = rowData[i][columnId];
    const text = value === null ? 'NULL' : String(value);
    const width = measureTextWidth(text, FONT);
    if (width > contentMaxWidth) contentMaxWidth = width;
  }

  const contentWidth = Math.max(headerWidth, contentMaxWidth) + config.padding;
  return Math.min(config.maxWidth, Math.max(config.minWidth, contentWidth));
}

function calculateColumnSizing(
  columns: ColumnDef<RowData>[],
  rowData: RowData[],
  resultSet: ResultSet
): Record<string, number> {
  const sizing: Record<string, number> = {};
  for (const col of columns) {
    const columnId = String(col.id);
    const config = resolveColumnConfig(columnId, resultSet);
    const headerText = String(col.header || '');
    sizing[columnId] = measureColumnWidth(columnId, headerText, rowData, config);
  }
  return sizing;
}

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

  const columnsRef = useRef(columns);
  const rowDataRef = useRef(rowData);
  const resultSetRef = useRef(resultSet);
  columnsRef.current = columns;
  rowDataRef.current = rowData;
  resultSetRef.current = resultSet;

  // 初回適用 (columnsKey 変化時のみ): paint 前に反映し default size からの flash を防ぐ (#368)
  useLayoutEffect(() => {
    if (!resultSet || rowDataRef.current.length === 0) return;
    const columnsKey = getColumnsKey(resultSet);
    if (columnsKey === appliedKeyRef.current) return;

    appliedKeyRef.current = columnsKey;
    const newSizing = calculateColumnSizing(columnsRef.current, rowDataRef.current, resultSet);
    setColumnSizing(newSizing);
    log.debug(`[useColumnAutoSize] Auto-sized for key: ${columnsKey}`);
  }, [resultSet]);

  const triggerAutoSize = useCallback(() => {
    const rs = resultSetRef.current;
    if (!rs || rowDataRef.current.length === 0) return;
    // 手動トリガー結果が次の columnsKey 変化時に上書きされないよう記録
    appliedKeyRef.current = getColumnsKey(rs);
    const newSizing = calculateColumnSizing(columnsRef.current, rowDataRef.current, rs);
    setColumnSizing(newSizing);
    log.debug('[useColumnAutoSize] Manual trigger: all columns');
  }, []);

  const triggerAutoSizeForColumn = useCallback((columnId: string) => {
    const rs = resultSetRef.current;
    if (!rs || rowDataRef.current.length === 0) return;
    const col = columnsRef.current.find((c) => String(c.id) === columnId);
    if (!col) return;

    const config = resolveColumnConfig(columnId, rs);
    const headerText = String(col.header || '');
    const width = measureColumnWidth(columnId, headerText, rowDataRef.current, config);

    setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
    log.debug(`[useColumnAutoSize] Manual trigger: ${columnId} = ${width}px`);
  }, []);

  return { columnSizing, setColumnSizing, triggerAutoSize, triggerAutoSizeForColumn };
}
