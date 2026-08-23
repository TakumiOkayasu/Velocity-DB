import type { AsyncColumn, AsyncPollResult, Column, QueryResult } from '../../../types';
import { defaultSettings } from '../../../utils/settingsUtils';
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

export const DEFAULT_QUERY_TIMEOUT_MS = defaultSettings.query.timeout;
const POLL_INTERVAL_MS = 100;

interface AbortHandle {
  promise: Promise<never>;
  cleanup: () => void;
}

class QueryTimeoutError extends Error {}

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

function createTimeoutHandle(timeoutMs: number): AbortHandle {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new QueryTimeoutError(
          `Query execution timed out after ${Math.round(timeoutMs / 1000)} seconds`
        )
      );
    }, timeoutMs);
  });
  const cleanup = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
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

  // Reuse one abort/deadline handle across all iterations. The deadline must race the IPC call
  // itself; checking elapsed time only between polls cannot stop a hung WebView2 invocation.
  const abortHandle = signal ? createAbortHandle(signal) : null;
  const timeout = timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const timeoutHandle = createTimeoutHandle(timeout);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Query cancelled', 'AbortError');
      }

      // Promise.race: IPC呼び出しブロック中でもAbortSignalを検知可能にする
      const pollPromise = bridge.getAsyncQueryResult(queryId);
      const guards = abortHandle
        ? [pollPromise, abortHandle.promise, timeoutHandle.promise]
        : [pollPromise, timeoutHandle.promise];
      const result = await Promise.race(guards);

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

      const delay = new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      await Promise.race(
        abortHandle
          ? [delay, abortHandle.promise, timeoutHandle.promise]
          : [delay, timeoutHandle.promise]
      );
    }
  } catch (error) {
    if (
      error instanceof QueryTimeoutError ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      await bridge.cancelAsyncQuery(queryId).catch(() => {});
    }
    throw error;
  } finally {
    abortHandle?.cleanup();
    timeoutHandle.cleanup();
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
