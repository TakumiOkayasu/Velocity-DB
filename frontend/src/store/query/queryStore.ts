import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { bridge } from '../../api/bridge';
import type { AbortRegistrable } from './interfaces/AbortRegistrable';
import { createDataViewSlice } from './slices/dataViewSlice';
import { createERDiagramSlice } from './slices/erDiagramSlice';
import { createFileIOSlice } from './slices/fileIOSlice';
import { createFormatSlice } from './slices/formatSlice';
import { createExecuteSlice } from './slices/queryExecuteSlice';
import { createManageSlice } from './slices/queryManageSlice';
import type { QueryState } from './types';

// DI: Abort controller registry (Omusubi Context Layer — owns mutable state)
const abortControllers = new Map<string, AbortController>();
const abortAdapter: AbortRegistrable = {
  register: (id, controller) => abortControllers.set(id, controller),
  abort: (id) => {
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
  },
  unregister: (id) => {
    abortControllers.delete(id);
  },
};

export const useQueryStore = create<QueryState>((set, get) => ({
  // Shared state
  queries: [],
  activeQueryId: null,
  results: {},
  executingQueryIds: new Set<string>(),
  errors: {},
  paginationStates: {},
  lintDiagnostics: {},
  runtimeDiagnostics: {},
  isExecuting: false,

  // Slices (Device Layer implementations injected via DI)
  ...createManageSlice(set, get, { abort: abortAdapter }),
  ...createExecuteSlice(set, get, { bridge, abort: abortAdapter }),
  ...createDataViewSlice(set, get, { bridge, abort: abortAdapter }),
  ...createFileIOSlice(set, get, { bridge }),
  ...createFormatSlice(set, get),
  ...createERDiagramSlice(set, get),
}));

// Optimized selectors to prevent unnecessary re-renders
export const useQueries = () => useQueryStore(useShallow((state) => state.queries));

export const useActiveQuery = () =>
  useQueryStore((state) => {
    const query = state.queries.find((q) => q.id === state.activeQueryId);
    return query ?? null;
  });

export const useIsActiveDataView = () =>
  useQueryStore(
    (state) => state.queries.find((q) => q.id === state.activeQueryId)?.isDataView === true
  );

export const useIsActiveERDiagram = () =>
  useQueryStore(
    (state) => state.queries.find((q) => q.id === state.activeQueryId)?.isERDiagram === true
  );

export const useQueryById = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? state.queries.find((q) => q.id === queryId) : undefined));

export const useQueryResult = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? (state.results[queryId] ?? null) : null));

/** Per-query error selector */
export const useQueryError = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? (state.errors[queryId] ?? null) : null));

/** Per-query executing state selector */
export const useIsQueryExecuting = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? state.executingQueryIds.has(queryId) : false));

/** Per-query pagination state selector */
export const usePaginationState = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? (state.paginationStates[queryId] ?? null) : null));

/** Per-query lint diagnostics selector (sqruff PRS) */
export const useLintDiagnostics = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? (state.lintDiagnostics[queryId] ?? null) : null));

/** Per-query runtime diagnostics selector (ODBC実行エラー等) */
export const useRuntimeDiagnostics = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? (state.runtimeDiagnostics[queryId] ?? null) : null));

export const useQueryActions = () =>
  useQueryStore(
    useShallow((state) => ({
      addQuery: state.addQuery,
      addQueryFromFile: state.addQueryFromFile,
      removeQuery: state.removeQuery,
      updateQuery: state.updateQuery,
      updateQueryConnection: state.updateQueryConnection,
      renameQuery: state.renameQuery,
      setActive: state.setActive,
      reorderQuery: state.reorderQuery,
      migrateConnection: state.migrateConnection,
      executeQuery: state.executeQuery,
      executeSelectedText: state.executeSelectedText,
      cancelQuery: state.cancelQuery,
      formatQuery: state.formatQuery,
      clearError: state.clearError,
      openTableData: state.openTableData,
      applyWhereFilter: state.applyWhereFilter,
      refreshDataView: state.refreshDataView,
      saveToFile: state.saveToFile,
      loadFromFile: state.loadFromFile,
      openERDiagram: state.openERDiagram,
      fetchMoreRows: state.fetchMoreRows,
      resetPaginatedSort: state.resetPaginatedSort,
    }))
  );
