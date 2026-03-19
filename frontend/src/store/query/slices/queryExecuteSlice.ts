import type { ResultSet } from '../../../types';
import { getSettings } from '../../../utils/settingsUtils';
import { executeAsyncWithPolling, toQueryResult } from '../helpers/asyncPolling';
import { endExecution, failExecution, startExecution } from '../helpers/executionState';
import { fetchAndUpdateRowCount } from '../helpers/paginationHelper';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { Executable } from '../interfaces/Executable';
import type { PaginatedBridgeable } from '../interfaces/PaginatedBridgeable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import type { GetState, SetState } from '../types';

interface ExecuteSliceDeps {
  bridge: QueryBridgeable & PaginatedBridgeable;
  abort: AbortRegistrable;
}

function hasExplicitLimit(sql: string): boolean {
  return (
    /\bTOP\s+\d+\b/i.test(sql) ||
    /\bLIMIT\s+\d+\b/i.test(sql) ||
    /\bFETCH\s+(?:FIRST|NEXT)\s+\d+/i.test(sql)
  );
}

export function createExecuteSlice(
  set: SetState,
  get: GetState,
  deps: ExecuteSliceDeps
): Executable {
  const { bridge, abort } = deps;

  const activeQueryIds = new Map<string, string>();

  async function executeAsync(id: string, connectionId: string, sql: string): Promise<void> {
    const controller = new AbortController();
    abort.register(id, controller);

    set((state) => startExecution(state, id));

    try {
      const timeoutMs = getSettings().query.timeout;
      const result = await executeAsyncWithPolling(
        bridge,
        connectionId,
        sql,
        controller.signal,
        (queryId) => {
          activeQueryIds.set(id, queryId);
        },
        timeoutMs
      );

      const queryResult = toQueryResult(result);

      set((state) => ({
        ...endExecution(state, id),
        results: { ...state.results, [id]: queryResult },
      }));

      if (!result.multipleResults && result.truncated && !hasExplicitLimit(sql)) {
        set((state) => ({
          paginationStates: {
            ...state.paginationStates,
            [id]: {
              totalRowCount: -1,
              loadedRowCount: (queryResult as ResultSet).rows.length,
              isLoadingMore: false,
              hasMore: true,
              baseSql: sql,
              connectionId,
            },
          },
        }));

        fetchAndUpdateRowCount(set, bridge, id, sql, connectionId);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        set((state) => endExecution(state, id));
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed';

      set((state) => failExecution(state, id, errorMessage));
    } finally {
      activeQueryIds.delete(id);
      abort.unregister(id);
    }
  }

  function clearPagination(id: string): void {
    set((state) => {
      const { [id]: _, ...rest } = state.paginationStates;
      return { paginationStates: rest };
    });
  }

  return {
    executeQuery: async (id, connectionId) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query || !query.content.trim()) return;
      clearPagination(id);
      await executeAsync(id, connectionId, query.content);
    },

    executeSelectedText: async (id, connectionId, selectedText) => {
      if (!selectedText.trim()) return;
      clearPagination(id);
      await executeAsync(id, connectionId, selectedText);
    },

    cancelQuery: async (connectionId) => {
      const { executingQueryIds, activeQueryId } = get();
      try {
        // Three-phase cancel: cancelAsyncQuery → abort → cancelQuery
        for (const id of executingQueryIds) {
          const queryId = activeQueryIds.get(id);
          if (queryId) {
            bridge.cancelAsyncQuery(queryId).catch((err) => {
              console.error('Failed to cancel async query:', err);
            });
          }
          abort.abort(id);
        }
        await bridge.cancelQuery(connectionId);
      } catch (error) {
        set((state) => ({
          errors: activeQueryId
            ? {
                ...state.errors,
                [activeQueryId]: error instanceof Error ? error.message : 'Failed to cancel query',
              }
            : state.errors,
        }));
      }
    },
  };
}
