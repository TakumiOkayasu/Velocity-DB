import type { AsyncQueryResultResponse, DatabaseType } from '../../types';
import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

type Column = { name: string; type: string; comment?: string };
type AsyncColumn = { name: string; type: string };

export type ExecuteQueryResult =
  | {
      columns: Column[];
      rows: (string | null)[][];
      affectedRows: number;
      executionTimeMs: number;
      cached: boolean;
    }
  | {
      multipleResults: true;
      results: {
        statement: string;
        data: {
          columns: AsyncColumn[];
          rows: (string | null)[][];
          affectedRows: number;
          executionTimeMs: number;
        };
      }[];
    };

export interface PaginatedQueryResult {
  columns: AsyncColumn[];
  rows: (string | null)[][];
  affectedRows: number;
  executionTimeMs: number;
}

export interface LintSqlResult {
  diagnostics: { line: number; column: number; code: string; message: string }[];
  lintUnavailable?: boolean;
  reason?: string;
}

export interface FilterResultSet {
  columns: AsyncColumn[];
  rows: (string | null)[][];
  totalRows: number;
  filteredRows: number;
  simdAvailable: boolean;
}

export type SortModel = Array<{ colId: string; sort: 'asc' | 'desc' }>;
export type FilterType = 'equals' | 'contains' | 'range';

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  timestamp: number;
  executionTimeMs: number;
  success: boolean;
  errorMessage: string;
  affectedRows: number;
  isFavorite: boolean;
}

export interface CacheStats {
  currentSizeBytes: number;
  maxSizeBytes: number;
  usagePercent: number;
}

export interface BuildWhereCondition {
  column: string;
  value: string | null;
}

export interface BuildDmlParams {
  schema: string;
  table: string;
  pkColumns: string[];
  updates?: {
    changes: Record<string, string | null>;
    originalData: Record<string, string | null>;
  }[];
  inserts?: Record<string, string | null>[];
  deletes?: Record<string, string | null>[];
}

export interface QueryProvider {
  executeQuery(connectionId: string, sql: string, useCache?: boolean): Promise<ExecuteQueryResult>;
  executeQueryPaginated(
    connectionId: string,
    sql: string,
    startRow: number,
    endRow: number,
    sortModel?: SortModel
  ): Promise<PaginatedQueryResult>;
  getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }>;
  cancelQuery(connectionId: string): Promise<void>;
  lintSql(sql: string, dbType: DatabaseType): Promise<LintSqlResult>;
  executeAsyncQuery(connectionId: string, sql: string): Promise<{ queryId: string }>;
  getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse>;
  cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }>;
  removeAsyncQuery(queryId: string): Promise<{ removed: boolean }>;
  getActiveQueries(): Promise<string[]>;
  filterResultSet(
    connectionId: string,
    sql: string,
    columnIndex: number,
    filterType: FilterType,
    filterValue: string,
    filterValueMax?: string
  ): Promise<FilterResultSet>;
  getExecutionPlan(
    connectionId: string,
    sql: string,
    actual?: boolean
  ): Promise<{ plan: string; actual: boolean }>;
  getQueryHistory(): Promise<QueryHistoryEntry[]>;
  removeQueryHistory(id: string): Promise<{ removed: boolean }>;
  clearQueryHistory(): Promise<{ cleared: boolean }>;
  setQueryHistoryFavorite(id: string, isFavorite: boolean): Promise<{ updated: boolean }>;
  getCacheStats(): Promise<CacheStats>;
  clearCache(): Promise<{ cleared: boolean }>;
  buildDataViewSql(
    connectionId: string,
    tableName: string,
    limit: number,
    whereClause?: string
  ): Promise<{ sql: string }>;
  buildWhereClause(
    connectionId: string,
    conditions: BuildWhereCondition[]
  ): Promise<{ whereClause: string }>;
  buildDmlStatements(
    connectionId: string,
    params: BuildDmlParams
  ): Promise<{ statements: string[] }>;
  uppercaseKeywords(sql: string): Promise<{ sql: string }>;
}

class QueryProviderImpl extends BaseProvider implements QueryProvider {
  async executeQuery(
    connectionId: string,
    sql: string,
    useCache = true
  ): Promise<ExecuteQueryResult> {
    return this.invokeAndParse('executeQuery', { connectionId, sql, useCache }, S.executeQuery);
  }

  async executeQueryPaginated(
    connectionId: string,
    sql: string,
    startRow: number,
    endRow: number,
    sortModel?: SortModel
  ): Promise<PaginatedQueryResult> {
    return this.invokeAndParse(
      'executeQueryPaginated',
      { connectionId, sql, startRow, endRow, sortModel },
      S.executeQueryPaginated
    );
  }

  async getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }> {
    return this.invokeAndParse('getRowCount', { connectionId, sql }, S.getRowCount);
  }

  async cancelQuery(connectionId: string): Promise<void> {
    await this.invokeAndParse('cancelQuery', { connectionId }, S.cancelQuery);
  }

  async lintSql(sql: string, dbType: DatabaseType): Promise<LintSqlResult> {
    return this.invokeAndParse('lintSql', { sql, dbType }, S.lintSql);
  }

  async executeAsyncQuery(connectionId: string, sql: string): Promise<{ queryId: string }> {
    return this.invokeAndParse('executeAsyncQuery', { connectionId, sql }, S.executeAsyncQuery);
  }

  async getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse> {
    return this.invokeAndParse('getAsyncQueryResult', { queryId }, S.getAsyncQueryResult);
  }

  async cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }> {
    return this.invokeAndParse('cancelAsyncQuery', { queryId }, S.cancelAsyncQuery);
  }

  async removeAsyncQuery(queryId: string): Promise<{ removed: boolean }> {
    return this.invokeAndParse('removeAsyncQuery', { queryId }, S.removeAsyncQuery);
  }

  async getActiveQueries(): Promise<string[]> {
    return this.invokeAndParse('getActiveQueries', {}, S.getActiveQueries);
  }

  async filterResultSet(
    connectionId: string,
    sql: string,
    columnIndex: number,
    filterType: FilterType,
    filterValue: string,
    filterValueMax?: string
  ): Promise<FilterResultSet> {
    return this.invokeAndParse(
      'filterResultSet',
      { connectionId, sql, columnIndex, filterType, filterValue, filterValueMax },
      S.filterResultSet
    );
  }

  async getExecutionPlan(
    connectionId: string,
    sql: string,
    actual = false
  ): Promise<{ plan: string; actual: boolean }> {
    return this.invokeAndParse(
      'getExecutionPlan',
      { connectionId, sql, actual },
      S.getExecutionPlan
    );
  }

  async getQueryHistory(): Promise<QueryHistoryEntry[]> {
    return this.invokeAndParse('getQueryHistory', {}, S.getQueryHistory);
  }

  async removeQueryHistory(id: string): Promise<{ removed: boolean }> {
    return this.invokeAndParse('removeQueryHistory', { id }, S.removeQueryHistory);
  }

  async clearQueryHistory(): Promise<{ cleared: boolean }> {
    return this.invokeAndParse('clearQueryHistory', {}, S.clearQueryHistory);
  }

  async setQueryHistoryFavorite(id: string, isFavorite: boolean): Promise<{ updated: boolean }> {
    return this.invokeAndParse(
      'setQueryHistoryFavorite',
      { id, isFavorite },
      S.setQueryHistoryFavorite
    );
  }

  async getCacheStats(): Promise<CacheStats> {
    return this.invokeAndParse('getCacheStats', {}, S.getCacheStats);
  }

  async clearCache(): Promise<{ cleared: boolean }> {
    return this.invokeAndParse('clearCache', {}, S.clearCache);
  }

  async buildDataViewSql(
    connectionId: string,
    tableName: string,
    limit: number,
    whereClause?: string
  ): Promise<{ sql: string }> {
    return this.invokeAndParse(
      'buildDataViewSql',
      { connectionId, tableName, limit, whereClause },
      S.buildDataViewSql
    );
  }

  async buildWhereClause(
    connectionId: string,
    conditions: BuildWhereCondition[]
  ): Promise<{ whereClause: string }> {
    return this.invokeAndParse(
      'buildWhereClause',
      { connectionId, conditions },
      S.buildWhereClause
    );
  }

  async buildDmlStatements(
    connectionId: string,
    params: BuildDmlParams
  ): Promise<{ statements: string[] }> {
    return this.invokeAndParse(
      'buildDmlStatements',
      { connectionId, ...params },
      S.buildDmlStatements
    );
  }

  async uppercaseKeywords(sql: string): Promise<{ sql: string }> {
    return this.invokeAndParse('uppercaseKeywords', { sql }, S.uppercaseKeywords);
  }
}

export function createQueryProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): QueryProvider {
  return new QueryProviderImpl(invoker, validator);
}
