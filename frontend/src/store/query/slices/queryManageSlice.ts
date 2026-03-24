import type { Query } from '../../../types';
import { generateQueryId, getQueryCounter } from '../helpers/executionState';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { Manageable } from '../interfaces/Manageable';
import type { GetState, SetState } from '../types';

interface ManageSliceDeps {
  abort: AbortRegistrable;
}

export function createManageSlice(set: SetState, get: GetState, deps: ManageSliceDeps): Manageable {
  const { abort } = deps;

  return {
    addQuery: (connectionId = null) => {
      const id = generateQueryId();
      const newQuery: Query = {
        id,
        name: `Query ${getQueryCounter()}`,
        content: '',
        connectionId,
        isDirty: false,
      };

      set((state) => ({
        queries: [...state.queries, newQuery],
        activeQueryId: id,
      }));
    },

    removeQuery: (id) => {
      abort.abort(id);

      const { queries, activeQueryId, results, errors, executingQueryIds, paginationStates } =
        get();
      const index = queries.findIndex((q) => q.id === id);
      const newQueries = queries.filter((q) => q.id !== id);

      const { [id]: _, ...newResults } = results;
      const { [id]: _err, ...newErrors } = errors;
      const { [id]: _pag, ...newPaginationStates } = paginationStates;

      const newExecuting = new Set(executingQueryIds);
      newExecuting.delete(id);

      let newActiveId: string | null = null;
      if (activeQueryId === id && newQueries.length > 0) {
        const newIndex = Math.min(index, newQueries.length - 1);
        newActiveId = newQueries[newIndex].id;
      } else if (activeQueryId !== id) {
        newActiveId = activeQueryId;
      }

      set({
        queries: newQueries,
        activeQueryId: newActiveId,
        results: newResults,
        errors: newErrors,
        executingQueryIds: newExecuting,
        isExecuting: newExecuting.size > 0,
        paginationStates: newPaginationStates,
      });
    },

    updateQuery: (id, content) => {
      set((state) => ({
        queries: state.queries.map((q) => (q.id === id ? { ...q, content, isDirty: true } : q)),
      }));
    },

    updateQueryConnection: (id, connectionId) => {
      set((state) => ({
        queries: state.queries.map((q) => (q.id === id ? { ...q, connectionId } : q)),
      }));
    },

    renameQuery: (id, name) => {
      set((state) => ({
        queries: state.queries.map((q) => (q.id === id ? { ...q, name } : q)),
      }));
    },

    setActive: (id) => {
      set({ activeQueryId: id });
    },

    migrateConnection: (oldId, newId) => {
      set((state) => ({
        queries: state.queries.map((q) =>
          q.connectionId === oldId ? { ...q, connectionId: newId } : q
        ),
      }));
    },

    reorderQuery: (fromIndex, toIndex) => {
      set((state) => {
        if (
          fromIndex < 0 ||
          fromIndex >= state.queries.length ||
          toIndex < 0 ||
          toIndex >= state.queries.length
        ) {
          return state;
        }
        const newQueries = [...state.queries];
        const [moved] = newQueries.splice(fromIndex, 1);
        newQueries.splice(toIndex, 0, moved);
        return { queries: newQueries };
      });
    },
  };
}
