import type { AsyncQueryResultResponse } from '../../../types';

export interface QueryBridgeable {
  executeAsyncQuery(
    connectionId: string,
    sql: string,
    maxRows?: number
  ): Promise<{ queryId: string }>;
  getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse>;
  cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }>;
  removeAsyncQuery(queryId: string): Promise<{ removed: boolean }>;
  cancelQuery(connectionId: string): Promise<void>;
}
