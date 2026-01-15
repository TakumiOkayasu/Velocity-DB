import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../../store/historyStore';
import { useQueryStore } from '../../store/queryStore';

// Mock the bridge module
vi.mock('../../api/bridge', () => ({
  bridge: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    executeQuery: vi.fn(),
    getColumns: vi.fn(),
    cancelQuery: vi.fn(),
    formatSQL: vi.fn(),
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
      isExecuting: false,
      error: null,
    });
    useHistoryStore.setState({ history: [], searchKeyword: '' });
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

  describe('executeQuery with history integration', () => {
    it('should record successful query to history', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      // Setup
      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'SELECT * FROM users');

      // Mock async query flow
      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'completed',
        columns: [{ name: 'id', type: 'int' }],
        rows: [['1'], ['2']],
        affectedRows: 0,
        executionTimeMs: 50,
      });

      // Execute
      await executeQuery(queryId, 'conn_1');

      // Verify history was recorded
      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT * FROM users');
      expect(history[0].success).toBe(true);
      expect(history[0].connectionId).toBe('conn_1');
      expect(history[0].executionTimeMs).toBe(50);
    });

    it('should record failed query to history', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      // Setup
      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'SELECT * FROM nonexistent');

      // Mock failed query
      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'failed',
        error: 'Table not found',
      });

      // Execute
      await executeQuery(queryId, 'conn_1');

      // Verify history was recorded with failure
      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT * FROM nonexistent');
      expect(history[0].success).toBe(false);
      expect(history[0].errorMessage).toBe('Table not found');
    });

    it('should set error state on failure', async () => {
      const { addQuery, updateQuery, executeQuery } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;
      updateQuery(queryId, 'INVALID SQL');

      mockedBridge.executeAsyncQuery.mockRejectedValue(new Error('Syntax error'));

      await executeQuery(queryId, 'conn_1');

      const { error, isExecuting } = useQueryStore.getState();
      expect(error).toBe('Syntax error');
      expect(isExecuting).toBe(false);
    });
  });

  describe('executeSelectedText with history integration', () => {
    it('should record selected text execution to history (async)', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      // Mock async query flow (same as executeQuery)
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

      // Verify history
      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT 42');
      expect(history[0].success).toBe(true);
      expect(history[0].executionTimeMs).toBe(25);
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

      // Verify result
      const { results } = useQueryStore.getState();
      expect(results[queryId]).toBeDefined();
      expect('multipleResults' in results[queryId] && results[queryId].multipleResults).toBe(true);

      // Verify history
      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT 1; SELECT 2');
      expect(history[0].success).toBe(true);
      expect(history[0].executionTimeMs).toBe(25); // 10 + 15
    });

    it('should not execute empty text', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      await executeSelectedText(queryId, 'conn_1', '   ');

      expect(mockedBridge.executeAsyncQuery).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().history).toHaveLength(0);
    });

    it('should record failed query to history', async () => {
      const { addQuery, executeSelectedText } = useQueryStore.getState();

      addQuery('conn_1');
      const { queries } = useQueryStore.getState();
      const queryId = queries[0].id;

      // Mock failed query
      mockedBridge.executeAsyncQuery.mockResolvedValue({ queryId: 'async_1' });
      mockedBridge.getAsyncQueryResult.mockResolvedValue({
        queryId: 'async_1',
        status: 'failed',
        error: 'Syntax error',
      });

      await executeSelectedText(queryId, 'conn_1', 'INVALID SQL');

      // Verify history was recorded with failure
      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(false);
      expect(history[0].errorMessage).toBe('Syntax error');

      // Verify error state
      const { error, isExecuting } = useQueryStore.getState();
      expect(error).toBe('Syntax error');
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
    it('should clear error state', () => {
      useQueryStore.setState({ error: 'Some error' });

      const { clearError } = useQueryStore.getState();
      clearError();

      expect(useQueryStore.getState().error).toBeNull();
    });
  });
});
