import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { bridge } from '../api/bridge';
import type { MultipleResultSet, Query, QueryResult, ResultSet } from '../types';
import { log } from '../utils/logger';

// Type guard for MultipleResultSet
function isMultipleResultSet(result: unknown): result is MultipleResultSet {
  return (
    typeof result === 'object' &&
    result !== null &&
    'multipleResults' in result &&
    (result as { multipleResults: unknown }).multipleResults === true
  );
}

interface QueryState {
  queries: Query[];
  activeQueryId: string | null;
  results: Record<string, QueryResult>;
  isExecuting: boolean;
  error: string | null;

  addQuery: (connectionId?: string | null) => void;
  removeQuery: (id: string) => void;
  updateQuery: (id: string, content: string) => void;
  renameQuery: (id: string, name: string) => void;
  setActive: (id: string | null) => void;
  executeQuery: (id: string, connectionId: string) => Promise<void>;
  executeSelectedText: (id: string, connectionId: string, selectedText: string) => Promise<void>;
  cancelQuery: (connectionId: string) => Promise<void>;
  formatQuery: (id: string) => Promise<void>;
  clearError: () => void;
  openTableData: (connectionId: string, tableName: string) => Promise<void>;
  applyWhereFilter: (id: string, connectionId: string, whereClause: string) => Promise<void>;
  saveToFile: (id: string) => Promise<void>;
  loadFromFile: (id: string) => Promise<void>;
}

let queryCounter = 0;

// Default query timeout (5 minutes)
const DEFAULT_QUERY_TIMEOUT_MS = 5 * 60 * 1000;

// Helper function to execute with timeout
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export const useQueryStore = create<QueryState>((set, get) => ({
  queries: [],
  activeQueryId: null,
  results: {},
  isExecuting: false,
  error: null,

  addQuery: (connectionId = null) => {
    const id = `query-${++queryCounter}`;
    const newQuery: Query = {
      id,
      name: `Query ${queryCounter}`,
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
    const { queries, activeQueryId, results } = get();
    const index = queries.findIndex((q) => q.id === id);
    const newQueries = queries.filter((q) => q.id !== id);

    // Update results (remove the entry for the deleted query)
    const { [id]: _, ...newResults } = results;

    // Determine new active query
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
    });
  },

  updateQuery: (id, content) => {
    set((state) => ({
      queries: state.queries.map((q) => (q.id === id ? { ...q, content, isDirty: true } : q)),
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

  executeQuery: async (id, connectionId) => {
    const query = get().queries.find((q) => q.id === id);
    if (!query || !query.content.trim()) return;

    set({ isExecuting: true, error: null });

    try {
      // Start async query execution
      const { queryId } = await bridge.executeAsyncQuery(connectionId, query.content);

      // Poll for results
      const pollInterval = 100; // Poll every 100ms
      const maxPollTime = DEFAULT_QUERY_TIMEOUT_MS;
      const startTime = Date.now();

      while (true) {
        // Check timeout
        if (Date.now() - startTime > maxPollTime) {
          throw new Error('Query execution timed out after 5 minutes');
        }

        const result = await bridge.getAsyncQueryResult(queryId);

        if (result.status === 'completed') {
          // Query completed successfully
          if (!result.columns || !result.rows) {
            throw new Error('Invalid query result: missing columns or rows');
          }

          const queryResult: QueryResult = {
            columns: result.columns.map((c) => ({
              name: c.name,
              type: c.type,
              size: 0,
              nullable: true,
              isPrimaryKey: false,
              comment: c.comment,
            })),
            rows: result.rows,
            affectedRows: result.affectedRows ?? 0,
            executionTimeMs: result.executionTimeMs ?? 0,
          };

          set((state) => ({
            results: { ...state.results, [id]: queryResult },
            isExecuting: false,
          }));
          break;
        } else if (result.status === 'failed') {
          throw new Error(result.error || 'Query execution failed');
        } else if (result.status === 'cancelled') {
          throw new Error('Query was cancelled');
        }

        // Status is 'pending' or 'running' - wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    } catch (error) {
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      });
    }
  },

  executeSelectedText: async (id, connectionId, selectedText) => {
    if (!selectedText.trim()) return;

    set({ isExecuting: true, error: null });

    try {
      const result = await withTimeout(
        bridge.executeQuery(connectionId, selectedText),
        DEFAULT_QUERY_TIMEOUT_MS,
        'Query execution timed out after 5 minutes'
      );

      // Check if result has multipleResults property
      let queryResult: QueryResult;

      if (isMultipleResultSet(result)) {
        // Multiple results format
        queryResult = {
          multipleResults: true,
          results: result.results.map(
            (r: {
              statement: string;
              data: {
                columns: { name: string; type: string; comment?: string }[];
                rows: string[][];
                affectedRows: number;
                executionTimeMs: number;
              };
            }) => ({
              statement: r.statement,
              data: {
                columns: r.data.columns.map((c) => ({
                  name: c.name,
                  type: c.type,
                  size: 0,
                  nullable: true,
                  isPrimaryKey: false,
                  comment: c.comment,
                })),
                rows: r.data.rows,
                affectedRows: r.data.affectedRows,
                executionTimeMs: r.data.executionTimeMs,
              },
            })
          ),
        };
      } else {
        // Single result format
        queryResult = {
          columns: result.columns.map((c: { name: string; type: string; comment?: string }) => ({
            name: c.name,
            type: c.type,
            size: 0,
            nullable: true,
            isPrimaryKey: false,
            comment: c.comment,
          })),
          rows: result.rows,
          affectedRows: result.affectedRows,
          executionTimeMs: result.executionTimeMs,
        };
      }

      set((state) => ({
        results: { ...state.results, [id]: queryResult },
        isExecuting: false,
      }));
    } catch (error) {
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      });
    }
  },

  cancelQuery: async (connectionId) => {
    try {
      await bridge.cancelQuery(connectionId);
      set({ isExecuting: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel query',
      });
    }
  },

  formatQuery: async (id) => {
    const query = get().queries.find((q) => q.id === id);
    if (!query || !query.content.trim()) return;

    try {
      const result = await bridge.formatSQL(query.content);
      set((state) => ({
        queries: state.queries.map((q) =>
          q.id === id ? { ...q, content: result.sql, isDirty: true } : q
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to format SQL',
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  openTableData: async (connectionId, tableName) => {
    log.info(
      `[QueryStore] openTableData called for table: ${tableName}, connection: ${connectionId}`
    );

    // Check if tab for this table already exists
    const existingQuery = get().queries.find(
      (q) => q.sourceTable === tableName && q.connectionId === connectionId && q.isDataView
    );

    if (existingQuery) {
      log.debug(
        `[QueryStore] Existing tab found for ${tableName}, activating: ${existingQuery.id}`
      );
      // Just activate the existing tab
      set({ activeQueryId: existingQuery.id });
      return;
    }

    const id = `query-${++queryCounter}`;
    const sql = `SELECT * FROM ${tableName}`;
    const newQuery: Query = {
      id,
      name: tableName,
      content: sql,
      connectionId,
      isDirty: false,
      sourceTable: tableName,
      isDataView: true,
      useServerSideRowModel: false, // Use client-side model (server-side requires Enterprise license)
    };

    log.info(`[QueryStore] Creating new query tab: ${id} for table ${tableName}`);

    set((state) => ({
      queries: [...state.queries, newQuery],
      activeQueryId: id,
      isExecuting: true,
      error: null,
    }));

    try {
      log.debug(`[QueryStore] Fetching table data for ${tableName}`);
      const fetchStart = performance.now();

      // Fetch column definitions (includes MS_Description comments)
      const columnDefinitions = await bridge.getColumns(connectionId, tableName);

      // Fetch table data
      const result = await bridge.executeQuery(connectionId, sql);
      const fetchEnd = performance.now();

      // Create a map of column names to comments
      const commentMap = new Map(columnDefinitions.map((col) => [col.name, col.comment]));

      const resultSet: ResultSet = {
        columns: result.columns.map((c) => ({
          name: c.name,
          type: c.type,
          size: 0,
          nullable: true,
          isPrimaryKey: false,
          comment: commentMap.get(c.name) || undefined,
        })),
        rows: result.rows,
        affectedRows: result.affectedRows,
        executionTimeMs: result.executionTimeMs,
      };

      set((state) => ({
        results: { ...state.results, [id]: resultSet },
        isExecuting: false,
      }));

      log.info(
        `[QueryStore] Loaded ${result.rows.length} rows with ${result.columns.length} columns in ${(fetchEnd - fetchStart).toFixed(2)}ms`
      );
    } catch (error) {
      log.error(`[QueryStore] Failed to fetch table data: ${error}`);
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Failed to load table data',
      });
    }
  },

  applyWhereFilter: async (id, connectionId, whereClause) => {
    const query = get().queries.find((q) => q.id === id);
    if (!query?.sourceTable) return;

    const baseSql = `SELECT * FROM ${query.sourceTable}`;
    const sql = whereClause.trim() ? `${baseSql} WHERE ${whereClause}` : baseSql;

    set((state) => ({
      queries: state.queries.map((q) => (q.id === id ? { ...q, content: sql, isDirty: true } : q)),
      isExecuting: true,
      error: null,
    }));

    try {
      // Fetch column definitions (includes MS_Description comments)
      const columnDefinitions = await bridge.getColumns(connectionId, query.sourceTable);

      const result = await withTimeout(
        bridge.executeQuery(connectionId, sql),
        DEFAULT_QUERY_TIMEOUT_MS,
        'Query execution timed out after 5 minutes'
      );

      // Create a map of column names to comments
      const commentMap = new Map(columnDefinitions.map((col) => [col.name, col.comment]));

      const resultSet: ResultSet = {
        columns: result.columns.map((c) => ({
          name: c.name,
          type: c.type,
          size: 0,
          nullable: true,
          isPrimaryKey: false,
          comment: commentMap.get(c.name) || undefined,
        })),
        rows: result.rows,
        affectedRows: result.affectedRows,
        executionTimeMs: result.executionTimeMs,
      };

      set((state) => ({
        results: { ...state.results, [id]: resultSet },
        isExecuting: false,
      }));
    } catch (error) {
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Failed to apply filter',
      });
    }
  },

  saveToFile: async (id) => {
    const query = get().queries.find((q) => q.id === id);
    if (!query || !query.content.trim()) return;

    try {
      const defaultFileName = query.filePath
        ? query.filePath.split('\\').pop()?.split('/').pop()
        : `${query.name}.sql`;

      const result = await bridge.saveQueryToFile(query.content, defaultFileName);

      log.info(`[QueryStore] Saved query to file: ${result.filePath}`);

      set((state) => ({
        queries: state.queries.map((q) =>
          q.id === id ? { ...q, filePath: result.filePath, isDirty: false } : q
        ),
      }));
    } catch (error) {
      // User cancelled or error occurred
      const message = error instanceof Error ? error.message : 'Failed to save file';
      if (!message.includes('cancelled')) {
        set({ error: message });
      }
    }
  },

  loadFromFile: async (id) => {
    try {
      const result = await bridge.loadQueryFromFile();

      log.info(`[QueryStore] Loaded query from file: ${result.filePath}`);

      set((state) => ({
        queries: state.queries.map((q) =>
          q.id === id
            ? { ...q, content: result.content, filePath: result.filePath, isDirty: false }
            : q
        ),
      }));
    } catch (error) {
      // User cancelled or error occurred
      const message = error instanceof Error ? error.message : 'Failed to load file';
      if (!message.includes('cancelled')) {
        set({ error: message });
      }
    }
  },
}));

// Optimized selectors to prevent unnecessary re-renders
export const useQueries = () => useQueryStore(useShallow((state) => state.queries));

export const useActiveQuery = () =>
  useQueryStore((state) => {
    const query = state.queries.find((q) => q.id === state.activeQueryId);
    return query ?? null;
  });

export const useQueryResult = (queryId: string | null) =>
  useQueryStore((state) => (queryId ? (state.results[queryId] ?? null) : null));

export const useQueryActions = () =>
  useQueryStore(
    useShallow((state) => ({
      addQuery: state.addQuery,
      removeQuery: state.removeQuery,
      updateQuery: state.updateQuery,
      renameQuery: state.renameQuery,
      setActive: state.setActive,
      executeQuery: state.executeQuery,
      executeSelectedText: state.executeSelectedText,
      cancelQuery: state.cancelQuery,
      formatQuery: state.formatQuery,
      clearError: state.clearError,
      openTableData: state.openTableData,
      applyWhereFilter: state.applyWhereFilter,
      saveToFile: state.saveToFile,
      loadFromFile: state.loadFromFile,
    }))
  );
