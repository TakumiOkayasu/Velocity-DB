// Re-export from refactored query module (slice-based architecture)

export type { QueryState } from './query';
export {
  useActiveQuery,
  useActiveQueryMeta,
  useIsActiveDataView,
  useIsActiveERDiagram,
  useIsQueryExecuting,
  useLintDiagnostics,
  usePaginationState,
  useQueries,
  useQueryActions,
  useQueryById,
  useQueryError,
  useQueryResult,
  useQueryStore,
  useRuntimeDiagnostics,
} from './query';
