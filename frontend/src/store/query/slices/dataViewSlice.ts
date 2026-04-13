import { bridge as apiBridge } from '../../../api/bridge';
import type { Query } from '../../../types';
import { log } from '../../../utils/logger';
import { getSettings } from '../../../utils/settingsUtils';
import { stripBrackets } from '../../../utils/stringUtils';
import {
  endExecution,
  failExecution,
  generateQueryId,
  startExecution,
} from '../helpers/executionState';
import { fetchTableWithComments, PAGE_SIZE, toBaseSql } from '../helpers/fetchTable';
import { fetchAndUpdateRowCount } from '../helpers/paginationHelper';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { ColumnBridgeable } from '../interfaces/ColumnBridgeable';
import type { DataViewable } from '../interfaces/DataViewable';
import type { PaginatedBridgeable } from '../interfaces/PaginatedBridgeable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import type { GetState, SetState } from '../types';

interface DataViewSliceDeps {
  bridge: QueryBridgeable & ColumnBridgeable & PaginatedBridgeable;
  abort: AbortRegistrable;
}

export function createDataViewSlice(
  set: SetState,
  get: GetState,
  deps: DataViewSliceDeps
): DataViewable {
  const { bridge, abort } = deps;

  function setupPagination(
    id: string,
    baseSql: string,
    connectionId: string,
    loadedRowCount: number
  ): void {
    set((state) => ({
      paginationStates: {
        ...state.paginationStates,
        [id]: {
          totalRowCount: -1,
          loadedRowCount,
          isLoadingMore: false,
          hasMore: true,
          baseSql,
          connectionId,
        },
      },
    }));
    fetchAndUpdateRowCount(set, bridge, id, baseSql, connectionId);
  }

  return {
    openTableData: async (connectionId, tableName, whereClause, logicalName) => {
      log.info(
        `[QueryStore] openTableData called for table: ${tableName}, connection: ${connectionId}${whereClause ? `, WHERE: ${whereClause}` : ''}`
      );

      if (!whereClause) {
        const existingQuery = get().queries.find(
          (q) => q.sourceTable === tableName && q.connectionId === connectionId && q.isDataView
        );

        if (existingQuery) {
          log.debug(
            `[QueryStore] Existing tab found for ${tableName}, activating: ${existingQuery.id}`
          );
          set({ activeQueryId: existingQuery.id });
          return;
        }
      }

      const id = generateQueryId();
      const controller = new AbortController();
      abort.register(id, controller);

      try {
        const { sql } = await apiBridge.buildDataViewSql(
          connectionId,
          tableName,
          PAGE_SIZE + 1,
          whereClause
        );
        const baseSql = toBaseSql(sql);
        const displayName = stripBrackets(tableName);
        const tabName = whereClause ? `${displayName} (フィルタ済)` : displayName;
        const newQuery: Query = {
          id,
          name: tabName,
          content: sql,
          connectionId,
          isDirty: false,
          sourceTable: tableName,
          whereClause: whereClause ?? '',
          isDataView: true,
          useServerSideRowModel: false,
          logicalName,
        };

        log.info(`[QueryStore] Creating new query tab: ${id} for table ${tableName}`);

        set((state) => ({
          ...startExecution(state, id),
          queries: [...state.queries, newQuery],
          activeQueryId: id,
        }));

        log.debug(`[QueryStore] Fetching table data for ${tableName}`);
        const fetchStart = performance.now();

        const resultSet = await fetchTableWithComments(
          bridge,
          connectionId,
          tableName,
          sql,
          controller.signal,
          getSettings().query.timeout
        );

        set((state) => ({
          ...endExecution(state, id),
          results: { ...state.results, [id]: resultSet },
        }));

        log.info(
          `[QueryStore] Loaded ${resultSet.rows.length} rows with ${resultSet.columns.length} columns in ${(performance.now() - fetchStart).toFixed(2)}ms`
        );

        if (resultSet.truncated) {
          setupPagination(id, baseSql, connectionId, resultSet.rows.length);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set((state) => endExecution(state, id));
          return;
        }
        log.error(`[QueryStore] Failed to fetch table data: ${error}`);
        set((state) =>
          failExecution(
            state,
            id,
            error instanceof Error ? error.message : 'Failed to load table data'
          )
        );
      } finally {
        abort.unregister(id);
      }
    },

    applyWhereFilter: async (id, connectionId, whereClause): Promise<string | null> => {
      const query = get().queries.find((q) => q.id === id);
      if (!query?.sourceTable) return null;

      const controller = new AbortController();
      abort.register(id, controller);

      try {
        const { sql } = await apiBridge.buildDataViewSql(
          connectionId,
          query.sourceTable,
          PAGE_SIZE + 1,
          whereClause.trim() || undefined
        );

        set((state) => ({
          ...startExecution(state, id),
          queries: state.queries.map((q) =>
            q.id === id ? { ...q, content: sql, whereClause: whereClause.trim(), isDirty: true } : q
          ),
        }));

        const resultSet = await fetchTableWithComments(
          bridge,
          connectionId,
          query.sourceTable,
          sql,
          controller.signal,
          getSettings().query.timeout
        );

        // Clear old pagination state
        set((state) => {
          const { [id]: _, ...restPagination } = state.paginationStates;
          return {
            ...endExecution(state, id),
            results: { ...state.results, [id]: resultSet },
            paginationStates: restPagination,
          };
        });

        if (resultSet.truncated) {
          const baseSql = toBaseSql(sql);
          setupPagination(id, baseSql, connectionId, resultSet.rows.length);
        }

        return null;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set((state) => endExecution(state, id));
          return null;
        }
        const message = error instanceof Error ? error.message : 'Failed to apply filter';
        log.error(`[QueryStore] Failed to apply WHERE filter: ${message}`);
        set((state) => endExecution(state, id));
        return message;
      } finally {
        abort.unregister(id);
      }
    },

    refreshDataView: async (id, connectionId) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query?.sourceTable) return;

      log.info(`[QueryStore] Refreshing data view: ${query.sourceTable}`);

      const controller = new AbortController();
      abort.register(id, controller);

      set((state) => startExecution(state, id));

      try {
        const resultSet = await fetchTableWithComments(
          bridge,
          connectionId,
          query.sourceTable,
          query.content,
          controller.signal,
          getSettings().query.timeout
        );

        // Clear old pagination state
        set((state) => {
          const { [id]: _, ...restPagination } = state.paginationStates;
          return {
            ...endExecution(state, id),
            results: { ...state.results, [id]: resultSet },
            paginationStates: restPagination,
          };
        });

        log.info(`[QueryStore] Data view refreshed: ${resultSet.rows.length} rows`);

        if (resultSet.truncated) {
          const baseSql = toBaseSql(query.content);
          setupPagination(id, baseSql, connectionId, resultSet.rows.length);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set((state) => endExecution(state, id));
          return;
        }
        set((state) =>
          failExecution(
            state,
            id,
            error instanceof Error ? error.message : 'データの更新に失敗しました'
          )
        );
      } finally {
        abort.unregister(id);
      }
    },

    fetchMoreRows: async (id) => {
      const pagination = get().paginationStates[id];
      if (!pagination || !pagination.hasMore || pagination.isLoadingMore) return;

      set((state) => ({
        paginationStates: {
          ...state.paginationStates,
          [id]: { ...state.paginationStates[id], isLoadingMore: true },
        },
      }));

      try {
        const result = await bridge.executeQueryPaginated(
          pagination.connectionId,
          pagination.baseSql,
          pagination.loadedRowCount,
          pagination.loadedRowCount + PAGE_SIZE,
          pagination.sortModel
        );

        set((state) => {
          const currentResult = state.results[id];
          if (!currentResult || 'multipleResults' in currentResult) return {};

          const newRows = currentResult.rows.concat(result.rows);
          const reachedEnd = result.rows.length < PAGE_SIZE;
          const newTotal =
            reachedEnd && pagination.totalRowCount === -1
              ? newRows.length
              : pagination.totalRowCount;

          return {
            results: {
              ...state.results,
              [id]: {
                ...currentResult,
                rows: newRows,
                truncated: !reachedEnd,
                totalRowCount: newTotal === -1 ? undefined : newTotal,
              },
            },
            paginationStates: {
              ...state.paginationStates,
              [id]: {
                ...state.paginationStates[id],
                loadedRowCount: newRows.length,
                isLoadingMore: false,
                hasMore: !reachedEnd,
                totalRowCount: newTotal,
              },
            },
          };
        });

        log.info(`[QueryStore] Loaded more rows for ${id}: +${result.rows.length} rows`);
      } catch (error) {
        log.error(`[QueryStore] Failed to fetch more rows: ${error}`);
        set((state) => ({
          paginationStates: {
            ...state.paginationStates,
            [id]: { ...state.paginationStates[id], isLoadingMore: false },
          },
        }));
      }
    },

    resetPaginatedSort: async (id, sortModel) => {
      const pagination = get().paginationStates[id];
      if (!pagination) return;

      set((state) => ({
        paginationStates: {
          ...state.paginationStates,
          [id]: { ...state.paginationStates[id], isLoadingMore: true, sortModel },
        },
      }));

      try {
        const result = await bridge.executeQueryPaginated(
          pagination.connectionId,
          pagination.baseSql,
          0,
          PAGE_SIZE,
          sortModel
        );

        set((state) => {
          const currentResult = state.results[id];
          if (!currentResult || 'multipleResults' in currentResult) return {};

          const reachedEnd = result.rows.length < PAGE_SIZE;
          return {
            results: {
              ...state.results,
              [id]: {
                ...currentResult,
                rows: result.rows,
                truncated: !reachedEnd,
              },
            },
            paginationStates: {
              ...state.paginationStates,
              [id]: {
                ...state.paginationStates[id],
                loadedRowCount: result.rows.length,
                isLoadingMore: false,
                hasMore: !reachedEnd,
                sortModel,
              },
            },
          };
        });
      } catch (error) {
        log.error(`[QueryStore] Failed to reset sort: ${error}`);
        set((state) => ({
          paginationStates: {
            ...state.paginationStates,
            [id]: { ...state.paginationStates[id], isLoadingMore: false },
          },
        }));
      }
    },
  };
}
