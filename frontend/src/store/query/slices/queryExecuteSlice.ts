import { getSettings } from '../../../utils/settingsUtils';
import { executeAsyncWithPolling, toQueryResult } from '../helpers/asyncPolling';
import { endExecution, failExecution, startExecution } from '../helpers/executionState';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { Executable } from '../interfaces/Executable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import type { GetState, SetState } from '../types';

interface ExecuteSliceDeps {
  bridge: QueryBridgeable;
  abort: AbortRegistrable;
}

export function createExecuteSlice(
  set: SetState,
  get: GetState,
  deps: ExecuteSliceDeps
): Executable {
  const { bridge, abort } = deps;

  // tabId → backend queryId mapping for direct cancel
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

      set((state) => ({
        ...endExecution(state, id),
        results: { ...state.results, [id]: toQueryResult(result) },
      }));
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

  return {
    executeQuery: async (id, connectionId) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query || !query.content.trim()) return;
      await executeAsync(id, connectionId, query.content);
    },

    executeSelectedText: async (id, connectionId, selectedText) => {
      if (!selectedText.trim()) return;
      await executeAsync(id, connectionId, selectedText);
    },

    cancelQuery: async (connectionId) => {
      const { executingQueryIds, activeQueryId } = get();
      try {
        // Three-phase cancel (defence-in-depth):
        // 1) cancelAsyncQuery — directly cancels backend async task by queryId
        // 2) abort.abort — immediately stops each polling loop (UI responsiveness)
        // 3) bridge.cancelQuery — connection-level backend cancel (catches queries
        //    not yet in polling or managed outside AbortController)
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
