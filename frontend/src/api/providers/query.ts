import type { AsyncQueryResultResponse, DatabaseType } from '../../types';
import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

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

class QueryProviderImpl implements QueryProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが #520+ で log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
  }

  async executeQuery(
    connectionId: string,
    sql: string,
    useCache = true
  ): Promise<ExecuteQueryResult> {
    const raw = await this.invoker.invoke('executeQuery', { connectionId, sql, useCache });
    return this.validator.parse(S.executeQuery, raw);
  }

  async executeQueryPaginated(
    connectionId: string,
    sql: string,
    startRow: number,
    endRow: number,
    sortModel?: SortModel
  ): Promise<PaginatedQueryResult> {
    const raw = await this.invoker.invoke('executeQueryPaginated', {
      connectionId,
      sql,
      startRow,
      endRow,
      sortModel,
    });
    return this.validator.parse(S.executeQueryPaginated, raw);
  }

  async getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }> {
    const raw = await this.invoker.invoke('getRowCount', { connectionId, sql });
    return this.validator.parse(S.getRowCount, raw);
  }

  async cancelQuery(connectionId: string): Promise<void> {
    // S.cancelQuery は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('cancelQuery', { connectionId });
  }

  async lintSql(sql: string, dbType: DatabaseType): Promise<LintSqlResult> {
    const raw = await this.invoker.invoke('lintSql', { sql, dbType });
    return this.validator.parse(S.lintSql, raw);
  }

  async executeAsyncQuery(connectionId: string, sql: string): Promise<{ queryId: string }> {
    const raw = await this.invoker.invoke('executeAsyncQuery', { connectionId, sql });
    return this.validator.parse(S.executeAsyncQuery, raw);
  }

  async getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse> {
    const raw = await this.invoker.invoke('getAsyncQueryResult', { queryId });
    return this.validator.parse(S.getAsyncQueryResult, raw);
  }

  async cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }> {
    const raw = await this.invoker.invoke('cancelAsyncQuery', { queryId });
    return this.validator.parse(S.cancelAsyncQuery, raw);
  }

  async removeAsyncQuery(queryId: string): Promise<{ removed: boolean }> {
    const raw = await this.invoker.invoke('removeAsyncQuery', { queryId });
    return this.validator.parse(S.removeAsyncQuery, raw);
  }

  async getActiveQueries(): Promise<string[]> {
    const raw = await this.invoker.invoke('getActiveQueries', {});
    return this.validator.parse(S.getActiveQueries, raw);
  }

  async filterResultSet(
    connectionId: string,
    sql: string,
    columnIndex: number,
    filterType: FilterType,
    filterValue: string,
    filterValueMax?: string
  ): Promise<FilterResultSet> {
    const raw = await this.invoker.invoke('filterResultSet', {
      connectionId,
      sql,
      columnIndex,
      filterType,
      filterValue,
      filterValueMax,
    });
    return this.validator.parse(S.filterResultSet, raw);
  }

  async getExecutionPlan(
    connectionId: string,
    sql: string,
    actual = false
  ): Promise<{ plan: string; actual: boolean }> {
    const raw = await this.invoker.invoke('getExecutionPlan', { connectionId, sql, actual });
    return this.validator.parse(S.getExecutionPlan, raw);
  }

  async getQueryHistory(): Promise<QueryHistoryEntry[]> {
    const raw = await this.invoker.invoke('getQueryHistory', {});
    return this.validator.parse(S.getQueryHistory, raw);
  }

  async removeQueryHistory(id: string): Promise<{ removed: boolean }> {
    const raw = await this.invoker.invoke('removeQueryHistory', { id });
    return this.validator.parse(S.removeQueryHistory, raw);
  }

  async clearQueryHistory(): Promise<{ cleared: boolean }> {
    const raw = await this.invoker.invoke('clearQueryHistory', {});
    return this.validator.parse(S.clearQueryHistory, raw);
  }

  async setQueryHistoryFavorite(id: string, isFavorite: boolean): Promise<{ updated: boolean }> {
    const raw = await this.invoker.invoke('setQueryHistoryFavorite', { id, isFavorite });
    return this.validator.parse(S.setQueryHistoryFavorite, raw);
  }

  async getCacheStats(): Promise<CacheStats> {
    const raw = await this.invoker.invoke('getCacheStats', {});
    return this.validator.parse(S.getCacheStats, raw);
  }

  async clearCache(): Promise<{ cleared: boolean }> {
    const raw = await this.invoker.invoke('clearCache', {});
    return this.validator.parse(S.clearCache, raw);
  }

  async buildDataViewSql(
    connectionId: string,
    tableName: string,
    limit: number,
    whereClause?: string
  ): Promise<{ sql: string }> {
    const raw = await this.invoker.invoke('buildDataViewSql', {
      connectionId,
      tableName,
      limit,
      whereClause,
    });
    return this.validator.parse(S.buildDataViewSql, raw);
  }

  async buildWhereClause(
    connectionId: string,
    conditions: BuildWhereCondition[]
  ): Promise<{ whereClause: string }> {
    const raw = await this.invoker.invoke('buildWhereClause', { connectionId, conditions });
    return this.validator.parse(S.buildWhereClause, raw);
  }

  async buildDmlStatements(
    connectionId: string,
    params: BuildDmlParams
  ): Promise<{ statements: string[] }> {
    const raw = await this.invoker.invoke('buildDmlStatements', { connectionId, ...params });
    return this.validator.parse(S.buildDmlStatements, raw);
  }

  async uppercaseKeywords(sql: string): Promise<{ sql: string }> {
    const raw = await this.invoker.invoke('uppercaseKeywords', { sql });
    return this.validator.parse(S.uppercaseKeywords, raw);
  }
}

export function createQueryProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): QueryProvider {
  return new QueryProviderImpl(invoker, logger, validator);
}
