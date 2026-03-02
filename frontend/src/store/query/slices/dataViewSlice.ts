import { bridge as apiBridge } from '../../../api/bridge';
import type { Query } from '../../../types';
import { log } from '../../../utils/logger';
import {
  endExecution,
  failExecution,
  generateQueryId,
  startExecution,
} from '../helpers/executionState';
import { DATA_VIEW_ROW_LIMIT, fetchTableWithComments } from '../helpers/fetchTable';
import type { AbortRegistrable } from '../interfaces/AbortRegistrable';
import type { ColumnBridgeable } from '../interfaces/ColumnBridgeable';
import type { DataViewable } from '../interfaces/DataViewable';
import type { QueryBridgeable } from '../interfaces/QueryBridgeable';
import type { GetState, SetState } from '../types';

interface DataViewSliceDeps {
  bridge: QueryBridgeable & ColumnBridgeable;
  abort: AbortRegistrable;
}

export function createDataViewSlice(
  set: SetState,
  get: GetState,
  deps: DataViewSliceDeps
): DataViewable {
  const { bridge, abort } = deps;

  return {
    openTableData: async (connectionId, tableName, whereClause, logicalName) => {
      log.info(
        `[QueryStore] openTableData called for table: ${tableName}, connection: ${connectionId}${whereClause ? `, WHERE: ${whereClause}` : ''}`
      );

      // When whereClause is specified, always create a new tab (for related row navigation)
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
          DATA_VIEW_ROW_LIMIT + 1,
          whereClause
        );
        const tabName = whereClause ? `${tableName} (フィルタ済)` : tableName;
        const newQuery: Query = {
          id,
          name: tabName,
          content: sql,
          connectionId,
          isDirty: false,
          sourceTable: tableName,
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
          controller.signal
        );

        set((state) => ({
          ...endExecution(state, id),
          results: { ...state.results, [id]: resultSet },
        }));

        log.info(
          `[QueryStore] Loaded ${resultSet.rows.length} rows with ${resultSet.columns.length} columns in ${(performance.now() - fetchStart).toFixed(2)}ms`
        );
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

    applyWhereFilter: async (id, connectionId, whereClause) => {
      const query = get().queries.find((q) => q.id === id);
      if (!query?.sourceTable) return;

      const controller = new AbortController();
      abort.register(id, controller);

      try {
        const { sql } = await apiBridge.buildDataViewSql(
          connectionId,
          query.sourceTable,
          DATA_VIEW_ROW_LIMIT + 1,
          whereClause.trim() || undefined
        );

        set((state) => ({
          ...startExecution(state, id),
          queries: state.queries.map((q) =>
            q.id === id ? { ...q, content: sql, isDirty: true } : q
          ),
        }));

        const resultSet = await fetchTableWithComments(
          bridge,
          connectionId,
          query.sourceTable,
          sql,
          controller.signal
        );

        set((state) => ({
          ...endExecution(state, id),
          results: { ...state.results, [id]: resultSet },
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set((state) => endExecution(state, id));
          return;
        }
        set((state) =>
          failExecution(
            state,
            id,
            error instanceof Error ? error.message : 'Failed to apply filter'
          )
        );
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
          controller.signal
        );

        set((state) => ({
          ...endExecution(state, id),
          results: { ...state.results, [id]: resultSet },
        }));

        log.info(`[QueryStore] Data view refreshed: ${resultSet.rows.length} rows`);
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
  };
}
