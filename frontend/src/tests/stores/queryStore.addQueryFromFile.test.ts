import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueryStore } from '../../store/queryStore';

vi.mock('../../api/providers', () => ({
  queryProvider: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    cancelQuery: vi.fn(),
  },
  schemaProvider: {
    getColumns: vi.fn(),
  },
  ioProvider: {
    saveQueryToFile: vi.fn(),
    loadQueryFromFile: vi.fn(),
  },
}));

describe('addQueryFromFile', () => {
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

  it('should create a new query tab with given name and content', () => {
    useQueryStore.getState().addQueryFromFile('test', 'SELECT 1', 'conn_1');

    const state = useQueryStore.getState();
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].name).toBe('test');
    expect(state.queries[0].content).toBe('SELECT 1');
    expect(state.queries[0].connectionId).toBe('conn_1');
    expect(state.activeQueryId).toBe(state.queries[0].id);
  });

  it('should default connectionId to null when omitted', () => {
    useQueryStore.getState().addQueryFromFile('test', 'SELECT 1');

    const state = useQueryStore.getState();
    expect(state.queries[0].connectionId).toBeNull();
  });

  it('should set isDirty to false', () => {
    useQueryStore.getState().addQueryFromFile('test', 'SELECT 1', 'conn_1');

    expect(useQueryStore.getState().queries[0].isDirty).toBe(false);
  });

  it('should not set filePath', () => {
    useQueryStore.getState().addQueryFromFile('test', 'SELECT 1', 'conn_1');

    expect(useQueryStore.getState().queries[0].filePath).toBeUndefined();
  });

  it('should append to existing queries and set as active', () => {
    const { addQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const firstId = useQueryStore.getState().queries[0].id;

    useQueryStore.getState().addQueryFromFile('dropped', 'SELECT 2', 'conn_1');

    const state = useQueryStore.getState();
    expect(state.queries).toHaveLength(2);
    expect(state.queries[0].id).toBe(firstId);
    expect(state.queries[1].name).toBe('dropped');
    expect(state.activeQueryId).toBe(state.queries[1].id);
  });
});
