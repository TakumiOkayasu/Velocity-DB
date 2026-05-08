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

  // --- History (#520) ---
  it('getQueryHistory は履歴エントリ配列を返す', async () => {
    mock.setResponse('getQueryHistory', [
      {
        id: 'h-1',
        sql: 'SELECT 1',
        connectionId: 'conn1',
        timestamp: 1000,
        executionTimeMs: 5,
        success: true,
        errorMessage: '',
        affectedRows: 0,
        isFavorite: false,
      },
    ]);

    const result = await queryProvider.getQueryHistory();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('h-1');
    expect(mock.calls[0]).toEqual({ method: 'getQueryHistory', params: {} });
  });

  it('removeQueryHistory は id を渡し removed フラグを返す', async () => {
    mock.setResponse('removeQueryHistory', { removed: true });

    const result = await queryProvider.removeQueryHistory('h-1');

    expect(result).toEqual({ removed: true });
    expect(mock.calls[0]).toEqual({ method: 'removeQueryHistory', params: { id: 'h-1' } });
  });

  it('clearQueryHistory は cleared フラグを返す', async () => {
    mock.setResponse('clearQueryHistory', { cleared: true });

    const result = await queryProvider.clearQueryHistory();

    expect(result).toEqual({ cleared: true });
    expect(mock.calls[0]).toEqual({ method: 'clearQueryHistory', params: {} });
  });

  it('setQueryHistoryFavorite は id/isFavorite を渡し updated フラグを返す', async () => {
    mock.setResponse('setQueryHistoryFavorite', { updated: true });

    const result = await queryProvider.setQueryHistoryFavorite('h-1', true);

    expect(result).toEqual({ updated: true });
    expect(mock.calls[0]).toEqual({
      method: 'setQueryHistoryFavorite',
      params: { id: 'h-1', isFavorite: true },
    });
  });

  it('setQueryHistoryFavorite は isFavorite=false でも正しく渡す', async () => {
    mock.setResponse('setQueryHistoryFavorite', { updated: true });

    await queryProvider.setQueryHistoryFavorite('h-1', false);

    expect(mock.calls[0]?.params).toMatchObject({ isFavorite: false });
  });

  // --- Cache (#520) ---
  it('getCacheStats は CacheStats を返す', async () => {
    mock.setResponse('getCacheStats', {
      currentSizeBytes: 100,
      maxSizeBytes: 1000,
      usagePercent: 10,
    });

    const result = await queryProvider.getCacheStats();

    expect(result).toEqual({ currentSizeBytes: 100, maxSizeBytes: 1000, usagePercent: 10 });
  });

  it('clearCache は cleared フラグを返す', async () => {
    mock.setResponse('clearCache', { cleared: true });

    const result = await queryProvider.clearCache();

    expect(result).toEqual({ cleared: true });
    expect(mock.calls[0]).toEqual({ method: 'clearCache', params: {} });
  });

  // --- SQL builder (#520) ---
  it('buildDataViewSql は whereClause を含む全パラメータを渡す', async () => {
    mock.setResponse('buildDataViewSql', { sql: 'SELECT TOP 10 * FROM [t] WHERE id = 1' });

    const result = await queryProvider.buildDataViewSql('conn1', 't', 10, 'id = 1');

    expect(result).toEqual({ sql: 'SELECT TOP 10 * FROM [t] WHERE id = 1' });
    expect(mock.calls[0]).toEqual({
      method: 'buildDataViewSql',
      params: { connectionId: 'conn1', tableName: 't', limit: 10, whereClause: 'id = 1' },
    });
  });

  it('buildDataViewSql は whereClause 省略時に undefined を渡す', async () => {
    mock.setResponse('buildDataViewSql', { sql: 'SELECT TOP 10 * FROM [t]' });

    await queryProvider.buildDataViewSql('conn1', 't', 10);

    expect(mock.calls[0]?.params).toMatchObject({ whereClause: undefined });
  });

  it('buildWhereClause は connectionId/conditions を渡し whereClause を返す', async () => {
    mock.setResponse('buildWhereClause', { whereClause: "id = 1 AND name = 'a'" });

    const result = await queryProvider.buildWhereClause('conn1', [
      { column: 'id', value: '1' },
      { column: 'name', value: 'a' },
    ]);

    expect(result.whereClause).toBe("id = 1 AND name = 'a'");
    expect(mock.calls[0]?.params).toEqual({
      connectionId: 'conn1',
      conditions: [
        { column: 'id', value: '1' },
        { column: 'name', value: 'a' },
      ],
    });
  });

  it('buildDmlStatements は connectionId をフラットに展開して params を渡す', async () => {
    mock.setResponse('buildDmlStatements', { statements: ["UPDATE t SET name='b' WHERE id=1"] });

    const result = await queryProvider.buildDmlStatements('conn1', {
      schema: 'dbo',
      table: 't',
      pkColumns: ['id'],
      updates: [{ changes: { name: 'b' }, originalData: { id: '1', name: 'a' } }],
    });

    expect(result.statements).toHaveLength(1);
    expect(mock.calls[0]?.params).toMatchObject({
      connectionId: 'conn1',
      schema: 'dbo',
      table: 't',
      pkColumns: ['id'],
    });
  });

  it('uppercaseKeywords は sql を渡し変換後 sql を返す', async () => {
    mock.setResponse('uppercaseKeywords', { sql: 'SELECT * FROM t' });

    const result = await queryProvider.uppercaseKeywords('select * from t');

    expect(result).toEqual({ sql: 'SELECT * FROM t' });
    expect(mock.calls[0]).toEqual({
      method: 'uppercaseKeywords',
      params: { sql: 'select * from t' },
    });
  });
});
