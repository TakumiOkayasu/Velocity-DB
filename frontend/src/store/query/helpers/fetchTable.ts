import type { ResultSet } from '../../../types';
import type { ColumnBridgeable } from '../interfaces/ColumnBridgeable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import { executeAsyncWithPolling } from './asyncPolling';

export const DATA_VIEW_ROW_LIMIT = 10000;

export async function fetchTableWithComments(
  bridge: QueryBridgeable & ColumnBridgeable,
  connectionId: string,
  tableName: string,
  sql: string,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<ResultSet> {
  const [columnDefinitions, pollResult] = await Promise.all([
    bridge.getColumns(connectionId, tableName),
    executeAsyncWithPolling(bridge, connectionId, sql, signal, undefined, timeoutMs),
  ]);

  if (pollResult.multipleResults) {
    throw new Error('Unexpected multiple results for data view query');
  }
  const result = pollResult;

  const colDefMap = new Map(columnDefinitions.map((col) => [col.name, col]));

  const isTruncated = result.rows.length > DATA_VIEW_ROW_LIMIT;
  const displayRows = isTruncated ? result.rows.slice(0, DATA_VIEW_ROW_LIMIT) : result.rows;

  return {
    columns: result.columns.map((c) => {
      const def = colDefMap.get(c.name);
      return {
        name: c.name,
        type: c.type,
        size: def?.size ?? 0,
        nullable: def?.nullable ?? true,
        isPrimaryKey: def?.isPrimaryKey ?? false,
        comment: def?.comment || undefined,
      };
    }),
    rows: displayRows,
    affectedRows: result.affectedRows,
    executionTimeMs: result.executionTimeMs,
    truncated: isTruncated,
  };
}
