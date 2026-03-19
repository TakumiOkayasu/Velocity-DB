import type { Query, QueryResult } from '../../types';
import type { DataViewable } from './interfaces/DataViewable';
import type { ERDiagrammable } from './interfaces/ERDiagrammable';
import type { Executable } from './interfaces/Executable';
import type { FileIOable } from './interfaces/FileIOable';
import type { Formattable } from './interfaces/Formattable';
import type { Manageable } from './interfaces/Manageable';

export interface PaginationState {
  totalRowCount: number;
  loadedRowCount: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  baseSql: string;
  connectionId: string;
  sortModel?: Array<{ colId: string; sort: 'asc' | 'desc' }>;
}

export interface QueryState
  extends Manageable,
    Executable,
    DataViewable,
    FileIOable,
    Formattable,
    ERDiagrammable {
  queries: Query[];
  activeQueryId: string | null;
  results: Record<string, QueryResult>;
  executingQueryIds: Set<string>;
  errors: Record<string, string | null>;
  paginationStates: Record<string, PaginationState>;
  /** @deprecated Use executingQueryIds instead. Kept for toolbar compatibility. */
  isExecuting: boolean;
}

export type SetState = (
  partial: Partial<QueryState> | ((state: QueryState) => Partial<QueryState>)
) => void;

export type GetState = () => QueryState;
