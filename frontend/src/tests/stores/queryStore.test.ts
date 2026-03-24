import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/mockSettingsUtils';
import { useQueryStore } from '../../store/queryStore';

// Mock the bridge module
vi.mock('../../api/bridge', () => ({
  bridge: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    executeQuery: vi.fn(),
    getColumns: vi.fn(),
    cancelQuery: vi.fn(),
  },
}));

// Import the mocked bridge
import { bridge } from '../../api/bridge';

const mockedBridge = vi.mocked(bridge);

describe('queryStore', () => {
  beforeEach(() => {
    // Reset stores before each test
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

  describe('addQuery', () => {
    it('should add a new query and set it as active', () => {
      const { addQuery } = useQueryStore.getState();

      addQuery('conn_1');

      const { queries, activeQueryId } = useQueryStore.getState();
      expect(queries).toHaveLength(1);
      expect(queries[0].connectionId).toBe('conn_1');
      expect(activeQueryId).toBe(queries[0].id);
    });

    it('should generate unique query ids', () => {
      const { addQuery } = useQueryStore.getState();

      addQuery();
      addQuery();

      const { queries } = useQueryStore.getState();
      expect(queries[0].id).not.toBe(queries[1].id);
    });
  });

  describe('removeQuery', () => {
    it('should remove query and its results', () => {
      const { addQuery, removeQuery } = useQueryStore.getState();

      addQuery();
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      // Simulate having results
      useQueryStore.setState({
        results: {
          [queryId]: {
            columns: [],
            rows: [],
            affectedRows: 0,
            executionTimeMs: 0,
          },
        },
      });

      removeQuery(queryId);

      const state = useQueryStore.getState();
      expect(state.queries).toHaveLength(0);
      expect(state.results[queryId]).toBeUndefined();
    });
  });

  describe('updateQuery', () => {
    it('should update query content and mark as dirty', () => {
      const { addQuery, updateQuery } = useQueryStore.getState();

      addQuery();
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      updateQuery(queryId, 'SELECT * FROM users');

      const updated = useQueryStore.getState().queries[0];
      expect(updated.content).toBe('SELECT * FROM users');
      expect(updated.isDirty).toBe(true);
    });
  });

  describe('executeQuery', () => {
    it('should store result on successful execution', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'SELECT * FROM users');

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'completed',
        columns: [{ name: 'id', type: 'int' }],
        rows: [['1'], ['2']],
        affectedRows: 0,
        executionTimeMs: 50,
      });

      await executeQuery(queryId, 'conn_1');

      const { results, isExecuting } = useQueryStore.getState();
      expect(results[queryId]).toBeDefined();
      expect('rows' in results[queryId] && results[queryId].rows).toHaveLength(2);
      expect(isExecuting).toBe(false);
    });

    it('should set error on async query failure', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'SELECT * FROM nonexistent');

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'failed',
        error: 'Table not found',
      });

      await executeQuery(queryId, 'conn_1');

      const { errors, isExecuting, executingQueryIds } = useQueryStore.getState();
      expect(errors[queryId]).toBe('Table not found');
      expect(isExecuting).toBe(false);
      expect(executingQueryIds.has(queryId)).toBe(false);
    });

    it('should set per-query error state on failure', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'INVALID SQL');

      mockedBridge.executeAsyncQuery.mockRejectedValue(new Error('Syntax error'));

      await executeQuery(queryId, 'conn_1');

      const { errors, isExecuting, executingQueryIds } = useQueryStore.getState();
      expect(errors[queryId]).toBe('Syntax error');
      expect(isExecuting).toBe(false);
      expect(executingQueryIds.has(queryId)).toBe(false);
    });
  });

  describe('executeSelectedText', () => {
    it('should store result on successful execution', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'completed',
        columns: [{ name: 'result', type: 'int' }],
        rows: [['42']],
        affectedRows: 0,
        executionTimeMs: 25,
      });

      await executeSelectedText(queryId, 'conn_1', 'SELECT 42');

      const { results, isExecuting } = useQueryStore.getState();
      expect(results[queryId]).toBeDefined();
      expect('rows' in results[queryId] && results[queryId].rows).toHaveLength(1);
      expect(isExecuting).toBe(false);
    });

    it('should handle multiple results (async)', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      // Mock async query flow with multiple results
      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'completed',
        multipleResults: true,
        results: [
          {
            statement: 'SELECT 1',
            data: {
              columns: [{ name: 'result', type: 'int' }],
              rows: [['1']],
              affectedRows: 0,
              executionTimeMs: 10,
            },
          },
          {
            statement: 'SELECT 2',
            data: {
              columns: [{ name: 'result', type: 'int' }],
              rows: [['2']],
              affectedRows: 0,
              executionTimeMs: 15,
            },
          },
        ],
      });

      await executeSelectedText(queryId, 'conn_1', 'SELECT 1; SELECT 2');

      const { results } = useQueryStore.getState();
      expect(results[queryId]).toBeDefined();
      expect('multipleResults' in results[queryId] && results[queryId].multipleResults).toBe(true);
    });

    it('should not execute empty text', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      await executeSelectedText(queryId, 'conn_1', '   ');

      expect(mockedBridge.executeAsyncQuery).not.toHaveBeenCalled();
    });

    it('should set error on failed execution', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'failed',
        error: 'Syntax error',
      });

      await executeSelectedText(queryId, 'conn_1', 'INVALID SQL');

      const { errors, isExecuting } = useQueryStore.getState();
      expect(errors[queryId]).toBe('Syntax error');
      expect(isExecuting).toBe(false);
    });
  });

  describe('setActive', () => {
    it('should change active query', () => {
      const { addQuery, setActive } = useQueryStore.getState();

      addQuery();
      addQuery();

      const { queries } = useQueryStore.getState();

      setActive(queries[0].id);
      expect(useQueryStore.getState().activeQueryId).toBe(queries[0].id);

      setActive(queries[1].id);
      expect(useQueryStore.getState().activeQueryId).toBe(queries[1].id);
    });
  });

  describe('clearError', () => {
    it('should clear specific query error', () => {
      useQueryStore.setState({ errors: { 'q-1': 'Some error', 'q-2': 'Other error' } });

      const { clearError } = useQueryStore.getState();
      clearError('q-1');

      const { errors } = useQueryStore.getState();
      expect(errors['q-1']).toBeNull();
      expect(errors['q-2']).toBe('Other error');
    });

    it('should clear all errors when no id specified', () => {
      useQueryStore.setState({ errors: { 'q-1': 'Error 1', 'q-2': 'Error 2' } });

      const { clearError } = useQueryStore.getState();
      clearError();

      expect(useQueryStore.getState().errors).toEqual({});
    });
  });

  describe('error isolation between tabs', () => {
    it('should not leak error from one query tab to another', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      // Create two tabs
      addQuery('conn_1');
      const tab1Id = useQueryStore.getState().queries[0].id;
      addQuery('conn_1');
      const tab2Id = useQueryStore.getState().queries[1].id;

      updateQuery(tab1Id, 'INVALID SQL');
      updateQuery(tab2Id, 'SELECT 1');

      // Fail tab1
      mockedBridge.executeAsyncQuery.mockRejectedValue(new Error('Syntax error'));
      await executeQuery(tab1Id, 'conn_1');

      // Tab1 has error, tab2 does not
      const { errors } = useQueryStore.getState();
      expect(errors[tab1Id]).toBe('Syntax error');
      expect(errors[tab2Id] ?? null).toBeNull();
    });
  });

  describe('removeAsyncQuery cleanup', () => {
    it('should call removeAsyncQuery on completed query', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;
      updateQuery(queryId, 'SELECT 1');

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'completed',
        columns: [{ name: 'result', type: 'int' }],
        rows: [['1']],
        affectedRows: 0,
        executionTimeMs: 5,
      });

      await executeQuery(queryId, 'conn_1');

      expect(mockedBridge.removeAsyncQuery).toHaveBeenCalledWith('async_1');
    });

    it('should call removeAsyncQuery on failed query', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;
      updateQuery(queryId, 'BAD SQL');

      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_2' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_2',
        status: 'failed',
        error: 'Syntax error',
      });

      await executeQuery(queryId, 'conn_1');

      expect(mockedBridge.removeAsyncQuery).toHaveBeenCalledWith('async_2');
    });
  });

  describe('migrateConnection', () => {
    it('該当タブの connectionId が newId に更新される', () => {
      const { addQuery } = useQueryStore.getState();
      addQuery('conn_1');
      addQuery('conn_1');

      useQueryStore.getState().migrateConnection('conn_1', 'conn_2');

      const updated = useQueryStore.getState().queries;
      expect(updated[0].connectionId).toBe('conn_2');
      expect(updated[1].connectionId).toBe('conn_2');
    });

    it('該当しないタブの connectionId は変更されない', () => {
      const { addQuery } = useQueryStore.getState();
      addQuery('conn_1');
      addQuery('conn_other');

      useQueryStore.getState().migrateConnection('conn_1', 'conn_2');

      const updated = useQueryStore.getState().queries;
      expect(updated[0].connectionId).toBe('conn_2');
      expect(updated[1].connectionId).toBe('conn_other');
    });

    it('oldId に該当するタブが無い場合、何も変更されない', () => {
      const { addQuery } = useQueryStore.getState();
      addQuery('conn_x');

      useQueryStore.getState().migrateConnection('conn_1', 'conn_2');

      const updated = useQueryStore.getState().queries;
      expect(updated[0].connectionId).toBe('conn_x');
    });
  });
});
