import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ioProvider, queryProvider, schemaProvider } from '../../api/providers';
import type { AbortRegistrable } from './interfaces/AbortRegistrable';
import type { ColumnBridgeable } from './interfaces/ColumnBridgeable';
import type { FileBridgeable } from './interfaces/FileBridgeable';
import type { PaginatedBridgeable } from './interfaces/PaginatedBridgeable';
import type { QueryBridgeable } from './interfaces/QueryBridgeable';
import { createDataViewSlice } from './slices/dataViewSlice';
import { createERDiagramSlice } from './slices/erDiagramSlice';
import { createFileIOSlice } from './slices/fileIOSlice';
import { createFormatSlice } from './slices/formatSlice';
import { createExecuteSlice } from './slices/queryExecuteSlice';
import { createManageSlice } from './slices/queryManageSlice';
import type { QueryState } from './types';

// 個別 provider を Bridgeable 契約に束ねる薄いアダプタ。
// 各 slice は narrow な Bridgeable interface に依存し、合成は queryStore (= 上位レイヤ) で行う。
const queryBridge: QueryBridgeable & ColumnBridgeable & PaginatedBridgeable = {
  executeAsyncQuery: (connectionId, sql) => queryProvider.executeAsyncQuery(connectionId, sql),
  getAsyncQueryResult: (queryId) => queryProvider.getAsyncQueryResult(queryId),
  cancelAsyncQuery: (queryId) => queryProvider.cancelAsyncQuery(queryId),
  removeAsyncQuery: (queryId) => queryProvider.removeAsyncQuery(queryId),
  cancelQuery: (connectionId) => queryProvider.cancelQuery(connectionId),
  executeQueryPaginated: (connectionId, sql, startRow, endRow, sortModel) =>
    queryProvider.executeQueryPaginated(connectionId, sql, startRow, endRow, sortModel),
  getRowCount: (connectionId, sql) => queryProvider.getRowCount(connectionId, sql),
  getColumns: (connectionId, table) => schemaProvider.getColumns(connectionId, table),
};

const fileBridge: FileBridgeable = {
  saveQueryToFile: (content, defaultFileName) =>
    ioProvider.saveQueryToFile(content, defaultFileName),
  loadQueryFromFile: () => ioProvider.loadQueryFromFile(),
};

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
  queriesById: {},
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
  ...createExecuteSlice(set, get, { bridge: queryBridge, abort: abortAdapter }),
  ...createDataViewSlice(set, get, { bridge: queryBridge, abort: abortAdapter }),
  ...createFileIOSlice(set, get, { bridge: fileBridge }),
  ...createFormatSlice(set, get),
  ...createERDiagramSlice(set, get),
}));

// Optimized selectors to prevent unnecessary re-renders
export const useQueries = () => useQueryStore(useShallow((state) => state.queries));

export const useActiveQuery = () =>
  useQueryStore((state) => state.queriesById[state.activeQueryId ?? ''] ?? null);

/** Active query のメタ情報 (connectionId / isDataView / name)。content は含まず、毎タイピング再レンダーを防ぐ。 */
export const useActiveQueryMeta = () =>
  useQueryStore(
    useShallow((s) => {
      const q = s.queriesById[s.activeQueryId ?? ''] ?? null;
      return {
        connectionId: q?.connectionId ?? null,
        isDataView: q?.isDataView === true,
        name: q?.name ?? null,
      };
    })
  );

export const useIsActiveDataView = () =>
  useQueryStore((state) => state.queriesById[state.activeQueryId ?? '']?.isDataView === true);

export const useIsActiveERDiagram = () =>
  useQueryStore((state) => state.queriesById[state.activeQueryId ?? '']?.isERDiagram === true);

export const useQueryById = (queryId: string | null | undefined) =>
  useQueryStore((state) => (queryId ? state.queriesById[queryId] : undefined));

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
