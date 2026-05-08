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
}

export function createQueryProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): QueryProvider {
  return new QueryProviderImpl(invoker, logger, validator);
}
