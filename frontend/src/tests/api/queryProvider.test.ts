import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, queryProvider } from '../../api/providers';

describe('queryProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  it('executeQuery は connectionId/sql/useCache を渡し schema parse 済みの単一結果を返す', async () => {
    mock.setResponse('executeQuery', {
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 1,
      executionTimeMs: 10,
      cached: false,
    });

    const result = await queryProvider.executeQuery('conn1', 'SELECT 1', true);

    expect('multipleResults' in result).toBe(false);
    if (!('multipleResults' in result)) {
      expect(result.columns).toEqual([{ name: 'id', type: 'int' }]);
      expect(result.rows).toEqual([['1']]);
    }
    expect(mock.calls[0]).toEqual({
      method: 'executeQuery',
      params: { connectionId: 'conn1', sql: 'SELECT 1', useCache: true },
    });
  });

  it('executeQuery は useCache を省略すると true を渡す', async () => {
    mock.setResponse('executeQuery', {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      cached: false,
    });

    await queryProvider.executeQuery('conn1', 'SELECT 1');

    expect(mock.calls[0]?.params).toMatchObject({ useCache: true });
  });

  it('executeQueryPaginated は sortModel を含む全パラメータを渡す', async () => {
    mock.setResponse('executeQueryPaginated', {
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 5,
    });

    const sortModel = [{ colId: 'id', sort: 'asc' as const }];
    await queryProvider.executeQueryPaginated('conn1', 'SELECT * FROM t', 0, 100, sortModel);

    expect(mock.calls[0]).toEqual({
      method: 'executeQueryPaginated',
      params: {
        connectionId: 'conn1',
        sql: 'SELECT * FROM t',
        startRow: 0,
        endRow: 100,
        sortModel,
      },
    });
  });

  it('getRowCount は rowCount を返す', async () => {
    mock.setResponse('getRowCount', { rowCount: 42 });

    const result = await queryProvider.getRowCount('conn1', 'SELECT * FROM t');

    expect(result).toEqual({ rowCount: 42 });
  });

  it('cancelQuery は connectionId を渡し void を返す', async () => {
    mock.setResponse('cancelQuery', null);

    await queryProvider.cancelQuery('conn1');

    expect(mock.calls[0]).toEqual({ method: 'cancelQuery', params: { connectionId: 'conn1' } });
  });

  it('lintSql は sql/dbType を渡し diagnostics を返す', async () => {
    mock.setResponse('lintSql', {
      diagnostics: [{ line: 1, column: 1, code: 'L1', message: 'm' }],
    });

    const result = await queryProvider.lintSql('SELECT 1', 'sqlserver');

    expect(result.diagnostics).toHaveLength(1);
    expect(mock.calls[0]?.params).toEqual({ sql: 'SELECT 1', dbType: 'sqlserver' });
  });

  it('executeAsyncQuery は queryId を返す', async () => {
    mock.setResponse('executeAsyncQuery', { queryId: 'q-1' });

    const result = await queryProvider.executeAsyncQuery('conn1', 'SELECT 1');

    expect(result).toEqual({ queryId: 'q-1' });
  });

  it('getAsyncQueryResult は queryId を渡し AsyncQueryResultResponse を返す', async () => {
    mock.setResponse('getAsyncQueryResult', { queryId: 'q-1', status: 'pending' });

    const result = await queryProvider.getAsyncQueryResult('q-1');

    expect(result).toEqual({ queryId: 'q-1', status: 'pending' });
  });

  it('getAsyncQueryResult schema は z.any() のため任意形状を素通しする (将来厳密化時の影響範囲を明文化)', async () => {
    mock.setResponse('getAsyncQueryResult', { arbitrary: 'shape', not: 'validated' });

    const result = await queryProvider.getAsyncQueryResult('q-1');

    expect(result).toEqual({ arbitrary: 'shape', not: 'validated' });
  });

  it('cancelAsyncQuery は cancelled フラグを返す', async () => {
    mock.setResponse('cancelAsyncQuery', { cancelled: true });

    const result = await queryProvider.cancelAsyncQuery('q-1');

    expect(result).toEqual({ cancelled: true });
  });

  it('removeAsyncQuery は removed フラグを返す', async () => {
    mock.setResponse('removeAsyncQuery', { removed: true });

    const result = await queryProvider.removeAsyncQuery('q-1');

    expect(result).toEqual({ removed: true });
  });

  it('getActiveQueries は string 配列を返す', async () => {
    mock.setResponse('getActiveQueries', ['q-1', 'q-2']);

    const result = await queryProvider.getActiveQueries();

    expect(result).toEqual(['q-1', 'q-2']);
  });

  it('filterResultSet は全パラメータを渡す', async () => {
    mock.setResponse('filterResultSet', {
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      totalRows: 100,
      filteredRows: 1,
      simdAvailable: true,
    });

    await queryProvider.filterResultSet('conn1', 'SELECT * FROM t', 0, 'equals', '1', '10');

    expect(mock.calls[0]).toEqual({
      method: 'filterResultSet',
      params: {
        connectionId: 'conn1',
        sql: 'SELECT * FROM t',
        columnIndex: 0,
        filterType: 'equals',
        filterValue: '1',
        filterValueMax: '10',
      },
    });
  });

  it('getExecutionPlan は actual を省略すると false を渡す', async () => {
    mock.setResponse('getExecutionPlan', { plan: 'p', actual: false });

    const result = await queryProvider.getExecutionPlan('conn1', 'SELECT 1');

    expect(result).toEqual({ plan: 'p', actual: false });
    expect(mock.calls[0]?.params).toMatchObject({ actual: false });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('cancelQuery', null);

    const { cancelQuery } = queryProvider;
    await cancelQuery('conn1');

    expect(mock.calls[0]?.method).toBe('cancelQuery');
  });

  it('schema 不一致のレスポンスは throw する', async () => {
    mock.setResponse('getRowCount', { wrong: 'field' });

    await expect(queryProvider.getRowCount('conn1', 'SELECT 1')).rejects.toThrow();
  });
});
