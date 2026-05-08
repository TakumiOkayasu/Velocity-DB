import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/mockSettingsUtils';
import { useQueryStore } from '../../store/queryStore';

vi.mock('../../api/bridge', () => ({
  bridge: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    cancelQuery: vi.fn(),
    getColumns: vi.fn(),
    saveQueryToFile: vi.fn(),
    loadQueryFromFile: vi.fn(),
  },
}));

// #520 で queryProvider に移管: buildDataViewSql
vi.mock('../../api/providers', () => ({
  queryProvider: {
    buildDataViewSql: vi.fn(),
  },
}));

import { bridge } from '../../api/bridge';
import { queryProvider } from '../../api/providers';

const mockedBridge = vi.mocked(bridge);
const mockedQueryProvider = vi.mocked(queryProvider);

function mockDataViewQuery(columns: { name: string; type: string }[], rows: string[][]) {
  mockedBridge.getColumns.mockResolvedValue([]);
  mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
  mockedBridge.getAsyncQueryResult.mockResolvedValue({
    queryId: 'async_1',
    status: 'completed',
    columns,
    rows,
    affectedRows: 0,
    executionTimeMs: 10,
  });
  mockedQueryProvider.buildDataViewSql.mockImplementation(
    async (_connId: string, tableName: string, limit: number, whereClause?: string) => {
      const quoted = tableName
        .split('.')
        .map((p: string) => `[${p}]`)
        .join('.');
      const sql = whereClause
        ? `SELECT TOP ${limit} * FROM ${quoted} WHERE ${whereClause}`
        : `SELECT TOP ${limit} * FROM ${quoted}`;
      return { sql };
    }
  );
}

function mockDataViewError(error: Error) {
  mockedBridge.getColumns.mockResolvedValue([]);
  mockedQueryProvider.buildDataViewSql.mockResolvedValue({
    sql: 'SELECT TOP 10001 * FROM [test]',
  });
  mockedBridge.executeAsyncQuery.mockRejectedValue(error);
}

describe('DataView operations', () => {
  beforeEach(() => {
    useQueryStore.setState({
      queries: [],
      activeQueryId: null,
      results: {},
      executingQueryIds: new Set<string>(),
      errors: {},
      isExecuting: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('openTableData', () => {
    it('should create a data view tab via buildDataViewSql', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');

      const state = useQueryStore.getState();
      expect(state.queries).toHaveLength(1);
      expect(state.queries[0].isDataView).toBe(true);
      expect(state.queries[0].sourceTable).toBe('dbo.Users');
      expect(state.queries[0].content).toContain('SELECT');
      expect(state.queries[0].content).toContain('dbo');
      expect(state.activeQueryId).toBe(state.queries[0].id);
      expect(mockedQueryProvider.buildDataViewSql).toHaveBeenCalledWith(
        'conn_1',
        'dbo.Users',
        10001,
        undefined
      );
    });

    it('should reuse existing tab for same table', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');
      const firstId = useQueryStore.getState().queries[0].id;

      // Open same table again
      await useQueryStore.getState().openTableData('conn_1', 'dbo.Users');

      const state = useQueryStore.getState();
      expect(state.queries).toHaveLength(1);
      expect(state.activeQueryId).toBe(firstId);
    });

    it('should create new tab when whereClause is specified', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');

      // Reset mock for second call
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);
      await useQueryStore.getState().openTableData('conn_1', 'dbo.Users', 'id = 1');

      const state = useQueryStore.getState();
      expect(state.queries).toHaveLength(2);
      expect(state.queries[1].content).toContain('WHERE id = 1');
      expect(mockedQueryProvider.buildDataViewSql).toHaveBeenCalledWith(
        'conn_1',
        'dbo.Users',
        10001,
        'id = 1'
      );
    });

    it('should strip brackets from tab name', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', '[Develop.MMS].[MMS]');

      const state = useQueryStore.getState();
      expect(state.queries[0].name).toBe('Develop.MMS.MMS');
      expect(state.queries[0].sourceTable).toBe('[Develop.MMS].[MMS]');
    });

    it('should strip brackets from filtered tab name', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', '[dbo].[Users]', 'id = 1');

      const state = useQueryStore.getState();
      expect(state.queries[0].name).toBe('dbo.Users (フィルタ済)');
    });

    it('should set error on failure', async () => {
      mockDataViewError(new Error('Connection lost'));

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');

      const state = useQueryStore.getState();
      const queryId = state.queries[0].id;
      expect(state.errors[queryId]).toBe('Connection lost');
      expect(state.isExecuting).toBe(false);
    });
  });

  describe('applyWhereFilter', () => {
    it('should update SQL with WHERE clause', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');
      const queryId = useQueryStore.getState().queries[0].id;

      // Apply filter
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);
      await useQueryStore.getState().applyWhereFilter(queryId, 'conn_1', 'age > 18');

      const state = useQueryStore.getState();
      expect(state.queries[0].content).toContain('WHERE age > 18');
      expect(state.queries[0].isDirty).toBe(true);
    });

    it('should clear WHERE when empty clause', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');
      const queryId = useQueryStore.getState().queries[0].id;

      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);
      await useQueryStore.getState().applyWhereFilter(queryId, 'conn_1', '');

      const state = useQueryStore.getState();
      expect(state.queries[0].content).not.toContain('WHERE');
    });
  });

  describe('refreshDataView', () => {
    it('should refresh data with same SQL', async () => {
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1']]);

      const { openTableData } = useQueryStore.getState();
      await openTableData('conn_1', 'dbo.Users');
      const queryId = useQueryStore.getState().queries[0].id;
      const originalSql = useQueryStore.getState().queries[0].content;

      // Refresh
      mockDataViewQuery([{ name: 'id', type: 'int' }], [['1'], ['2']]);
      await useQueryStore.getState().refreshDataView(queryId, 'conn_1');

      const state = useQueryStore.getState();
      expect(state.queries[0].content).toBe(originalSql);
      expect(state.results[queryId]).toBeDefined();
    });
  });
});
