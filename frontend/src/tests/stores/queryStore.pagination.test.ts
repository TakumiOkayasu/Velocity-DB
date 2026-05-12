import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/mockSettingsUtils';
import { PAGE_SIZE } from '../../store/query/helpers/fetchTable';
import { useQueryStore } from '../../store/queryStore';

vi.mock('../../api/providers', () => ({
  queryProvider: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    cancelQuery: vi.fn(),
    executeQueryPaginated: vi.fn(),
    getRowCount: vi.fn(),
    buildDataViewSql: vi.fn(),
  },
  schemaProvider: {
    getColumns: vi.fn(),
  },
}));

import { queryProvider, schemaProvider } from '../../api/providers';

const mockedBridge = { ...vi.mocked(queryProvider), ...vi.mocked(schemaProvider) };
const mockedQueryProvider = vi.mocked(queryProvider);

function mockTruncatedDataView(rowCount: number) {
  const rows = Array.from({ length: PAGE_SIZE }, (_, i) => [String(i)]);
  mockedBridge.getColumns.mockResolvedValue([]);
  mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
  mockedBridge.getAsyncQueryResult.mockResolvedValue({
    queryId: 'async_1',
    status: 'completed',
    columns: [{ name: 'id', type: 'int' }],
    rows,
    affectedRows: 0,
    executionTimeMs: 10,
    truncated: true,
  });
  mockedQueryProvider.buildDataViewSql.mockImplementation(
    async (_connId: string, tableName: string, limit: number) => ({
      sql: `SELECT TOP ${limit} * FROM [${tableName}]`,
    })
  );
  mockedBridge.getRowCount.mockResolvedValue({ rowCount });
}

describe('DataView pagination', () => {
  beforeEach(() => {
    useQueryStore.setState({
      queries: [],
      activeQueryId: null,
      results: {},
      executingQueryIds: new Set<string>(),
      errors: {},
      paginationStates: {},
      isExecuting: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => vi.clearAllMocks());

  it('truncated時にpaginationStatesを即座に初期化する', async () => {
    mockTruncatedDataView(50000);
    await useQueryStore.getState().openTableData('conn_1', 'dbo.Users');

    const state = useQueryStore.getState();
    const queryId = state.queries[0].id;
    const pag = state.paginationStates[queryId];

    expect(pag).toBeDefined();
    expect(pag.hasMore).toBe(true);
    expect(pag.loadedRowCount).toBe(PAGE_SIZE);
    expect(pag.connectionId).toBe('conn_1');
    expect(pag.baseSql).toBe('SELECT * FROM [dbo.Users]');
  });

  it('getRowCount成功でtotalRowCountを更新する', async () => {
    mockTruncatedDataView(50000);
    await useQueryStore.getState().openTableData('conn_1', 'dbo.Users');

    await vi.waitFor(() => {
      const qid = useQueryStore.getState().queries[0].id;
      const pag = useQueryStore.getState().paginationStates[qid];
      expect(pag).toBeDefined();
      expect(pag.totalRowCount).toBe(50000);
    });
  });

  it('fetchMoreRows: 次ページの行を追加結合する', async () => {
    // State を直接セットして fetchMoreRows のみテスト
    const queryId = 'q-fetch';
    const initialRows = Array.from({ length: PAGE_SIZE }, (_, i) => [String(i)]);
    useQueryStore.setState({
      results: {
        [queryId]: {
          columns: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
          rows: initialRows,
          affectedRows: 0,
          executionTimeMs: 10,
        },
      },
      paginationStates: {
        [queryId]: {
          totalRowCount: 25000,
          loadedRowCount: PAGE_SIZE,
          isLoadingMore: false,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    const nextPageRows = Array.from({ length: 5000 }, (_, i) => [String(PAGE_SIZE + i)]);
    mockedBridge.executeQueryPaginated.mockResolvedValue({
      columns: [{ name: 'id', type: 'int' }],
      rows: nextPageRows,
      affectedRows: 0,
      executionTimeMs: 5,
    });

    await useQueryStore.getState().fetchMoreRows(queryId);

    const state = useQueryStore.getState();
    const result = state.results[queryId];
    if (!('multipleResults' in result)) {
      expect(result.rows.length).toBe(PAGE_SIZE + 5000);
    }
    expect(state.paginationStates[queryId].loadedRowCount).toBe(PAGE_SIZE + 5000);
    expect(mockedBridge.executeQueryPaginated).toHaveBeenCalledWith(
      'conn_1',
      'SELECT * FROM t',
      PAGE_SIZE,
      PAGE_SIZE + PAGE_SIZE,
      undefined
    );
  });

  it('fetchMoreRows: 最終ページ(< PAGE_SIZE) で hasMore=false', async () => {
    const queryId = 'q-last';
    useQueryStore.setState({
      results: {
        [queryId]: {
          columns: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
          rows: Array.from({ length: PAGE_SIZE }, (_, i) => [String(i)]),
          affectedRows: 0,
          executionTimeMs: 10,
        },
      },
      paginationStates: {
        [queryId]: {
          totalRowCount: 10500,
          loadedRowCount: PAGE_SIZE,
          isLoadingMore: false,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    mockedBridge.executeQueryPaginated.mockResolvedValue({
      columns: [{ name: 'id', type: 'int' }],
      rows: Array.from({ length: 500 }, (_, i) => [String(i)]),
      affectedRows: 0,
      executionTimeMs: 5,
    });

    await useQueryStore.getState().fetchMoreRows(queryId);

    const pag = useQueryStore.getState().paginationStates[queryId];
    expect(pag.hasMore).toBe(false);
    expect(pag.isLoadingMore).toBe(false);
    expect(pag.loadedRowCount).toBe(PAGE_SIZE + 500);
  });

  it('fetchMoreRows: hasMore=false時はスキップする', async () => {
    useQueryStore.setState({
      paginationStates: {
        'q-done': {
          totalRowCount: 100,
          loadedRowCount: 100,
          isLoadingMore: false,
          hasMore: false,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    await useQueryStore.getState().fetchMoreRows('q-done');
    expect(mockedBridge.executeQueryPaginated).not.toHaveBeenCalled();
  });

  it('fetchMoreRows: isLoadingMore=true時はスキップする', async () => {
    useQueryStore.setState({
      paginationStates: {
        'q-loading': {
          totalRowCount: 50000,
          loadedRowCount: 10000,
          isLoadingMore: true,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    await useQueryStore.getState().fetchMoreRows('q-loading');
    expect(mockedBridge.executeQueryPaginated).not.toHaveBeenCalled();
  });

  it('fetchMoreRows: paginationState未設定時はスキップする', async () => {
    await useQueryStore.getState().fetchMoreRows('nonexistent');
    expect(mockedBridge.executeQueryPaginated).not.toHaveBeenCalled();
  });

  it('resetPaginatedSort: データをリセットしてソート適用', async () => {
    const queryId = 'q-sort';
    useQueryStore.setState({
      results: {
        [queryId]: {
          columns: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
          rows: Array.from({ length: PAGE_SIZE }, (_, i) => [String(i)]),
          affectedRows: 0,
          executionTimeMs: 10,
        },
      },
      paginationStates: {
        [queryId]: {
          totalRowCount: 50000,
          loadedRowCount: PAGE_SIZE,
          isLoadingMore: false,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    const sortedRows = Array.from({ length: PAGE_SIZE }, (_, i) => [String(PAGE_SIZE - i)]);
    mockedBridge.executeQueryPaginated.mockResolvedValue({
      columns: [{ name: 'id', type: 'int' }],
      rows: sortedRows,
      affectedRows: 0,
      executionTimeMs: 5,
    });

    const sortModel = [{ colId: 'id', sort: 'desc' as const }];
    await useQueryStore.getState().resetPaginatedSort(queryId, sortModel);

    const state = useQueryStore.getState();
    const result = state.results[queryId];
    if (!('multipleResults' in result)) {
      expect(result.rows[0][0]).toBe(String(PAGE_SIZE));
    }
    expect(state.paginationStates[queryId].sortModel).toEqual(sortModel);
    expect(state.paginationStates[queryId].loadedRowCount).toBe(PAGE_SIZE);
    expect(mockedBridge.executeQueryPaginated).toHaveBeenCalledWith(
      'conn_1',
      'SELECT * FROM t',
      0,
      PAGE_SIZE,
      sortModel
    );
  });

  it('resetPaginatedSort: pagination未設定時はスキップする', async () => {
    await useQueryStore.getState().resetPaginatedSort('nonexistent', []);
    expect(mockedBridge.executeQueryPaginated).not.toHaveBeenCalled();
  });

  it('applyWhereFilter: truncatedでない結果でpaginationStateをクリアする', async () => {
    mockTruncatedDataView(50000);
    await useQueryStore.getState().openTableData('conn_1', 'dbo.Users');
    const queryId = useQueryStore.getState().queries[0].id;

    // paginationState が設定されるのを待つ
    await vi.waitFor(() => {
      expect(useQueryStore.getState().paginationStates[queryId]).toBeDefined();
    });

    // 少数行を返すモック（truncatedなし）
    mockedBridge.getColumns.mockResolvedValue([]);
    mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_2' });
    mockedBridge.getAsyncQueryResult.mockResolvedValue({
      queryId: 'async_2',
      status: 'completed',
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 5,
    });

    await useQueryStore.getState().applyWhereFilter(queryId, 'conn_1', 'id = 1');

    expect(useQueryStore.getState().paginationStates[queryId]).toBeUndefined();
  });

  it('removeQuery: paginationStatesもクリーンアップする', () => {
    const queryId = 'q-cleanup';
    useQueryStore.setState({
      queries: [{ id: queryId, name: 'test', content: '', connectionId: null, isDirty: false }],
      activeQueryId: queryId,
      results: {},
      paginationStates: {
        [queryId]: {
          totalRowCount: 50000,
          loadedRowCount: 10000,
          isLoadingMore: false,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    useQueryStore.getState().removeQuery(queryId);
    expect(useQueryStore.getState().paginationStates[queryId]).toBeUndefined();
  });
});

describe('Query execute pagination', () => {
  beforeEach(() => {
    useQueryStore.setState({
      queries: [],
      activeQueryId: null,
      results: {},
      executingQueryIds: new Set<string>(),
      errors: {},
      paginationStates: {},
      isExecuting: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => vi.clearAllMocks());

  it('truncated結果でpaginationStatesを初期化する', async () => {
    const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT * FROM big_table');

    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => [String(i)]);
    mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
    mockedBridge.getAsyncQueryResult.mockResolvedValue({
      queryId: 'async_1',
      status: 'completed',
      columns: [{ name: 'id', type: 'int' }],
      rows,
      affectedRows: 0,
      executionTimeMs: 50,
      truncated: true,
    });
    mockedBridge.getRowCount.mockResolvedValue({ rowCount: 100000 });

    await executeQuery(queryId, 'conn_1');

    const pag = useQueryStore.getState().paginationStates[queryId];
    expect(pag).toBeDefined();
    expect(pag.hasMore).toBe(true);
    expect(pag.baseSql).toBe('SELECT * FROM big_table');
  });

  it('hasExplicitLimit: TOP付きSQLではpagination無効', async () => {
    const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT TOP 100 * FROM big_table');

    mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
    mockedBridge.getAsyncQueryResult.mockResolvedValue({
      queryId: 'async_1',
      status: 'completed',
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 50,
      truncated: true,
    });

    await executeQuery(queryId, 'conn_1');
    expect(useQueryStore.getState().paginationStates[queryId]).toBeUndefined();
  });

  it('hasExplicitLimit: LIMIT付きSQLではpagination無効', async () => {
    const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT * FROM big_table LIMIT 500');

    mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
    mockedBridge.getAsyncQueryResult.mockResolvedValue({
      queryId: 'async_1',
      status: 'completed',
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 50,
      truncated: true,
    });

    await executeQuery(queryId, 'conn_1');
    expect(useQueryStore.getState().paginationStates[queryId]).toBeUndefined();
  });

  it('再実行でpaginationStatesをクリアする', async () => {
    const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT * FROM t');

    useQueryStore.setState({
      paginationStates: {
        [queryId]: {
          totalRowCount: 50000,
          loadedRowCount: 10000,
          isLoadingMore: false,
          hasMore: true,
          baseSql: 'SELECT * FROM t',
          connectionId: 'conn_1',
        },
      },
    });

    mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
    mockedBridge.getAsyncQueryResult.mockResolvedValue({
      queryId: 'async_1',
      status: 'completed',
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 5,
    });

    await executeQuery(queryId, 'conn_1');
    expect(useQueryStore.getState().paginationStates[queryId]).toBeUndefined();
  });
});
