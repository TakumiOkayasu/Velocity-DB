import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Query, ResultSet } from '../types'
import { bridge } from '../api/bridge'

interface QueryState {
  queries: Query[];
  activeQueryId: string | null;
  results: Map<string, ResultSet>;
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
}

let queryCounter = 0

export const useQueryStore = create<QueryState>((set, get) => ({
  queries: [],
  activeQueryId: null,
  results: new Map(),
  isExecuting: false,
  error: null,

  addQuery: (connectionId = null) => {
    const id = `query-${++queryCounter}`
    const newQuery: Query = {
      id,
      name: `Query ${queryCounter}`,
      content: '',
      connectionId,
      isDirty: false,
    }

    set((state) => ({
      queries: [...state.queries, newQuery],
      activeQueryId: id,
    }))
  },

  removeQuery: (id) => {
    const { queries, activeQueryId, results } = get()
    const index = queries.findIndex((q) => q.id === id)
    const newQueries = queries.filter((q) => q.id !== id)

    // Update results map
    const newResults = new Map(results)
    newResults.delete(id)

    // Determine new active query
    let newActiveId: string | null = null
    if (activeQueryId === id && newQueries.length > 0) {
      const newIndex = Math.min(index, newQueries.length - 1)
      newActiveId = newQueries[newIndex].id
    } else if (activeQueryId !== id) {
      newActiveId = activeQueryId
    }

    set({
      queries: newQueries,
      activeQueryId: newActiveId,
      results: newResults,
    })
  },

  updateQuery: (id, content) => {
    set((state) => ({
      queries: state.queries.map((q) =>
        q.id === id ? { ...q, content, isDirty: true } : q
      ),
    }))
  },

  renameQuery: (id, name) => {
    set((state) => ({
      queries: state.queries.map((q) =>
        q.id === id ? { ...q, name } : q
      ),
    }))
  },

  setActive: (id) => {
    set({ activeQueryId: id })
  },

  executeQuery: async (id, connectionId) => {
    const query = get().queries.find((q) => q.id === id)
    if (!query || !query.content.trim()) return

    set({ isExecuting: true, error: null })

    try {
      const result = await bridge.executeQuery(connectionId, query.content)

      const resultSet: ResultSet = {
        columns: result.columns.map((c) => ({
          name: c.name,
          type: c.type,
          size: 0,
          nullable: true,
          isPrimaryKey: false,
        })),
        rows: result.rows,
        affectedRows: result.affectedRows,
        executionTimeMs: result.executionTimeMs,
      }

      set((state) => {
        const newResults = new Map(state.results)
        newResults.set(id, resultSet)
        return { results: newResults, isExecuting: false }
      })
    } catch (error) {
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      })
    }
  },

  executeSelectedText: async (id, connectionId, selectedText) => {
    if (!selectedText.trim()) return

    set({ isExecuting: true, error: null })

    try {
      const result = await bridge.executeQuery(connectionId, selectedText)

      const resultSet: ResultSet = {
        columns: result.columns.map((c) => ({
          name: c.name,
          type: c.type,
          size: 0,
          nullable: true,
          isPrimaryKey: false,
        })),
        rows: result.rows,
        affectedRows: result.affectedRows,
        executionTimeMs: result.executionTimeMs,
      }

      set((state) => {
        const newResults = new Map(state.results)
        newResults.set(id, resultSet)
        return { results: newResults, isExecuting: false }
      })
    } catch (error) {
      set({
        isExecuting: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
      })
    }
  },

  cancelQuery: async (connectionId) => {
    try {
      await bridge.cancelQuery(connectionId)
      set({ isExecuting: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel query',
      })
    }
  },

  formatQuery: async (id) => {
    const query = get().queries.find((q) => q.id === id)
    if (!query || !query.content.trim()) return

    try {
      const result = await bridge.formatSQL(query.content)
      set((state) => ({
        queries: state.queries.map((q) =>
          q.id === id ? { ...q, content: result.sql, isDirty: true } : q
        ),
      }))
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to format SQL',
      })
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))

// Optimized selectors to prevent unnecessary re-renders
export const useQueries = () =>
  useQueryStore(useShallow((state) => state.queries))

export const useActiveQuery = () =>
  useQueryStore((state) => {
    const query = state.queries.find((q) => q.id === state.activeQueryId)
    return query ?? null
  })

export const useQueryResult = (queryId: string | null) =>
  useQueryStore((state) => (queryId ? state.results.get(queryId) ?? null : null))

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
    }))
  )
