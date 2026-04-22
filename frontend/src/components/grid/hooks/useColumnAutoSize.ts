import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function finalizeColumnWidth(
  headerWidth: number,
  contentMaxWidth: number,
  config: ColumnSizeConfig
): number {
  const contentWidth = Math.max(headerWidth, contentMaxWidth) + config.padding;
  return Math.min(config.maxWidth, Math.max(config.minWidth, contentWidth));
}

const FONT = '13px monospace';
const HEADER_FONT = '600 13px system-ui, sans-serif';
const ROW_INDEX_CONFIG: ColumnSizeConfig = { minWidth: 32, maxWidth: 60, padding: 4 };

// Issue #387: 原則は全行計測だが、超大規模データでメインスレッド長時間ブロックを避けるため
// 閾値超過時は先頭 SYNC_FULL_LIMIT 行にフォールバックする。
const SYNC_FULL_LIMIT = 20000;

// Phase 2 (Issue #387): SYNC_THRESHOLD を超える rowData は chunk + yield で非同期計測し、
// メインスレッドを解放する (PROBE 実測で 25-52 秒ブロック → 数秒 UI 応答性維持へ)。
// 閾値以下は同期を維持 (小規模テーブルでは flash 回避を優先)。
const SYNC_THRESHOLD = 500;
const ASYNC_CHUNK_ROWS = 500;

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
  const limit = Math.min(rowData.length, SYNC_FULL_LIMIT);
  for (let i = 0; i < limit; i++) {
    const value = rowData[i][columnId];
    const text = value === null ? 'NULL' : String(value);
    const width = measureTextWidth(text, FONT);
    if (width > contentMaxWidth) contentMaxWidth = width;
  }

  return finalizeColumnWidth(headerWidth, contentMaxWidth, config);
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

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// chunk 単位で yield しつつ列幅を計測する。abort 時は null を返す。
async function measureColumnWidthAsync(
  columnId: string,
  headerText: string,
  rowData: RowData[],
  config: ColumnSizeConfig,
  shouldAbort: () => boolean
): Promise<number | null> {
  const headerWidth = measureTextWidth(headerText, HEADER_FONT);
  let contentMaxWidth = 0;
  const limit = Math.min(rowData.length, SYNC_FULL_LIMIT);
  for (let start = 0; start < limit; start += ASYNC_CHUNK_ROWS) {
    const end = Math.min(start + ASYNC_CHUNK_ROWS, limit);
    for (let i = start; i < end; i++) {
      const value = rowData[i][columnId];
      const text = value === null ? 'NULL' : String(value);
      const width = measureTextWidth(text, FONT);
      if (width > contentMaxWidth) contentMaxWidth = width;
    }
    await yieldToMain();
    if (shouldAbort()) return null;
  }
  return finalizeColumnWidth(headerWidth, contentMaxWidth, config);
}

async function calculateColumnSizingAsync(
  columns: ColumnDef<RowData>[],
  rowData: RowData[],
  resultSet: ResultSet,
  shouldAbort: () => boolean
): Promise<Record<string, number> | null> {
  const sizing: Record<string, number> = {};
  for (const col of columns) {
    if (shouldAbort()) return null;
    const columnId = String(col.id);
    const config = resolveColumnConfig(columnId, resultSet);
    const headerText = String(col.header || '');
    const width = await measureColumnWidthAsync(columnId, headerText, rowData, config, shouldAbort);
    if (width === null) return null;
    sizing[columnId] = width;
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

  // cancellation token: 計測中に columnsKey 変化 / 再 trigger で古い結果を破棄する
  const measurementIdRef = useRef(0);
  const beginMeasurement = useCallback(() => {
    const myId = ++measurementIdRef.current;
    return () => measurementIdRef.current !== myId;
  }, []);

  // unmount 時に進行中の async 計測を無効化する (古い結果による setState を防ぐ)
  useEffect(() => {
    return () => {
      measurementIdRef.current++;
    };
  }, []);

  const runFullMeasurement = useCallback(
    (rs: ResultSet) => {
      const rows = rowDataRef.current;
      if (rows.length <= SYNC_THRESHOLD) {
        const newSizing = calculateColumnSizing(columnsRef.current, rows, rs);
        setColumnSizing(newSizing);
        return;
      }
      const shouldAbort = beginMeasurement();
      calculateColumnSizingAsync(columnsRef.current, rows, rs, shouldAbort)
        .then((sizing) => {
          if (sizing && !shouldAbort()) setColumnSizing(sizing);
        })
        .catch((err: unknown) => {
          log.error(`[useColumnAutoSize] async measurement failed: ${String(err)}`);
        });
    },
    [beginMeasurement]
  );

  // 初回適用 (columnsKey 変化時のみ): 小規模は paint 前に反映 (#368)、
  // 大規模は async で後追い反映 (メインスレッドブロック回避を優先)
  useLayoutEffect(() => {
    if (!resultSet || rowDataRef.current.length === 0) return;
    const columnsKey = getColumnsKey(resultSet);
    if (columnsKey === appliedKeyRef.current) return;

    appliedKeyRef.current = columnsKey;
    runFullMeasurement(resultSet);
    log.debug(`[useColumnAutoSize] Auto-sized for key: ${columnsKey}`);
  }, [resultSet, runFullMeasurement]);

  const triggerAutoSize = useCallback(() => {
    const rs = resultSetRef.current;
    if (!rs || rowDataRef.current.length === 0) return;
    // 手動トリガー結果が次の columnsKey 変化時に上書きされないよう記録
    appliedKeyRef.current = getColumnsKey(rs);
    runFullMeasurement(rs);
    log.debug('[useColumnAutoSize] Manual trigger: all columns');
  }, [runFullMeasurement]);

  const triggerAutoSizeForColumn = useCallback(
    (columnId: string) => {
      const rs = resultSetRef.current;
      if (!rs || rowDataRef.current.length === 0) return;
      const col = columnsRef.current.find((c) => String(c.id) === columnId);
      if (!col) return;

      const config = resolveColumnConfig(columnId, rs);
      const headerText = String(col.header || '');
      const rows = rowDataRef.current;

      if (rows.length <= SYNC_THRESHOLD) {
        const width = measureColumnWidth(columnId, headerText, rows, config);
        setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
        log.debug(`[useColumnAutoSize] Manual trigger: ${columnId} = ${width}px`);
        return;
      }
      const shouldAbort = beginMeasurement();
      measureColumnWidthAsync(columnId, headerText, rows, config, shouldAbort)
        .then((width) => {
          if (width === null || shouldAbort()) return;
          setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
          log.debug(`[useColumnAutoSize] Manual trigger: ${columnId} = ${width}px`);
        })
        .catch((err: unknown) => {
          log.error(`[useColumnAutoSize] async measurement failed for ${columnId}: ${String(err)}`);
        });
    },
    [beginMeasurement]
  );

  return { columnSizing, setColumnSizing, triggerAutoSize, triggerAutoSizeForColumn };
}
