import type { AsyncColumn, AsyncPollResult, Column, QueryResult } from '../../../types';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';

function mapAsyncColumn(c: AsyncColumn): Column {
  return {
    name: c.name,
    type: c.type,
    size: 0,
    nullable: true,
    isPrimaryKey: false,
    comment: c.comment,
  };
}

export const DEFAULT_QUERY_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 100;

interface AbortHandle {
  promise: Promise<never>;
  cleanup: () => void;
}

function createAbortHandle(signal: AbortSignal): AbortHandle {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Query cancelled', 'AbortError'));
      return;
    }
    onAbort = () => reject(new DOMException('Query cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const cleanup = () => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  };
  return { promise, cleanup };
}

export async function executeAsyncWithPolling(
  bridge: QueryBridgeable,
  connectionId: string,
  sql: string,
  signal?: AbortSignal,
  onQueryIdReady?: (queryId: string) => void,
  timeoutMs?: number
): Promise<AsyncPollResult> {
  const { queryId } = await bridge.executeAsyncQuery(connectionId, sql);
  onQueryIdReady?.(queryId);

  // Create a single abort handle to reuse across all iterations (avoids unhandled rejections)
  const abortHandle = signal ? createAbortHandle(signal) : null;

  try {
    const startTime = Date.now();
    const timeout = timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    while (true) {
      if (signal?.aborted) {
        await bridge.cancelAsyncQuery(queryId).catch(() => {});
        throw new DOMException('Query cancelled', 'AbortError');
      }

      if (Date.now() - startTime > timeout) {
        try {
          await bridge.cancelAsyncQuery(queryId);
        } catch {
          // Ignore cancel errors
        }
        throw new Error(`Query execution timed out after ${Math.round(timeout / 1000)} seconds`);
      }

      // Promise.race: IPC呼び出しブロック中でもAbortSignalを検知可能にする
      const pollPromise = bridge.getAsyncQueryResult(queryId);
      const result = abortHandle
        ? await Promise.race([pollPromise, abortHandle.promise])
        : await pollPromise;

      if (result.status === 'completed') {
        if (result.multipleResults) {
          return {
            multipleResults: true,
            results: result.results,
          };
        }
        return {
          columns: result.columns,
          rows: result.rows,
          affectedRows: result.affectedRows,
          executionTimeMs: result.executionTimeMs,
          truncated: result.truncated,
        };
      } else if (result.status === 'failed') {
        throw new Error(result.error);
      } else if (result.status === 'cancelled') {
        throw new Error('Query was cancelled');
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    abortHandle?.cleanup();
    // Release backend memory for this query (single cleanup point).
    // Runs on all exit paths: success, failure, timeout, and abort.
    bridge.removeAsyncQuery(queryId).catch((err) => {
      console.error('Failed to remove async query:', err);
    });
  }
}

export function toQueryResult(result: AsyncPollResult): QueryResult {
  if (result.multipleResults) {
    return {
      multipleResults: true,
      results: result.results.map((r) => ({
        statement: r.statement,
        data: {
          columns: r.data.columns.map(mapAsyncColumn),
          rows: r.data.rows,
          affectedRows: r.data.affectedRows,
          executionTimeMs: r.data.executionTimeMs,
          truncated: r.data.truncated,
        },
      })),
    };
  }

  return {
    columns: result.columns.map(mapAsyncColumn),
    rows: result.rows,
    affectedRows: result.affectedRows,
    executionTimeMs: result.executionTimeMs,
    truncated: result.truncated,
  };
}
