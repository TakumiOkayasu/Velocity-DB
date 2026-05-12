import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueryStore } from '../../store/queryStore';
import { useToastStore } from '../../store/toastStore';

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

vi.mock('../../utils/sqlFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/sqlFormat')>();
  return { ...actual, formatSQL: vi.fn(actual.formatSQL) };
});

import { ioProvider } from '../../api/providers';
import { formatSQL as mockedFormatSQL } from '../../utils/sqlFormat';

const mockedBridge = vi.mocked(ioProvider);

describe('formatQuery', () => {
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

  it('should format query content via sql-formatter', async () => {
    const { addQuery, updateQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'select * from users where id = 1');

    await useQueryStore.getState().formatQuery(queryId);

    const state = useQueryStore.getState();
    expect(state.queries[0].content).toContain('SELECT');
    expect(state.queries[0].content).toContain('FROM');
    expect(state.queries[0].isDirty).toBe(true);
    expect(mockedFormatSQL).toHaveBeenCalledWith('select * from users where id = 1');
  });

  it('should not format empty content', async () => {
    const { addQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;

    await useQueryStore.getState().formatQuery(queryId);

    expect(mockedFormatSQL).not.toHaveBeenCalled();
  });

  it('should not format data view tabs', async () => {
    useQueryStore.setState({
      queries: [
        {
          id: 'dv-1',
          name: 'Users',
          content: 'SELECT TOP 1001 * FROM Users',
          connectionId: 'conn_1',
          isDirty: false,
          isDataView: true,
          sourceTable: 'Users',
        },
      ],
      activeQueryId: 'dv-1',
    });

    await useQueryStore.getState().formatQuery('dv-1');

    expect(mockedFormatSQL).not.toHaveBeenCalled();
  });

  it('should show toast and not set query error on format failure', async () => {
    const { addQuery, updateQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'INVALID');

    useToastStore.setState({ toasts: [] });

    vi.mocked(mockedFormatSQL).mockImplementationOnce(() => {
      throw new Error('Parse error at token: ;');
    });

    await useQueryStore.getState().formatQuery(queryId);

    expect(useQueryStore.getState().errors[queryId]).toBeUndefined();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].message).toContain('Parse error at token: ;');
  });
});

describe('File I/O', () => {
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

  describe('saveToFile', () => {
    it('should save content and update filePath', async () => {
      const { addQuery, updateQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;
      updateQuery(queryId, 'SELECT 1');

      mockedBridge.saveQueryToFile.mockResolvedValue({ filePath: 'C:\\test.sql' });

      await useQueryStore.getState().saveToFile(queryId);

      const state = useQueryStore.getState();
      expect(state.queries[0].filePath).toBe('C:\\test.sql');
      expect(state.queries[0].isDirty).toBe(false);
    });

    it('should not save empty content', async () => {
      const { addQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;

      await useQueryStore.getState().saveToFile(queryId);

      expect(mockedBridge.saveQueryToFile).not.toHaveBeenCalled();
    });

    it('should ignore cancelled save dialog', async () => {
      const { addQuery, updateQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;
      updateQuery(queryId, 'SELECT 1');

      mockedBridge.saveQueryToFile.mockRejectedValue(new Error('Save cancelled'));

      await useQueryStore.getState().saveToFile(queryId);

      expect(useQueryStore.getState().errors[queryId]).toBeUndefined();
    });
  });

  describe('loadFromFile', () => {
    it('should load content and update filePath', async () => {
      const { addQuery } = useQueryStore.getState();
      addQuery('conn_1');
      const queryId = useQueryStore.getState().queries[0].id;

      mockedBridge.loadQueryFromFile.mockResolvedValue({
        filePath: 'C:\\loaded.sql',
        content: 'SELECT * FROM loaded_table',
      });

      await useQueryStore.getState().loadFromFile(queryId);

      const state = useQueryStore.getState();
      expect(state.queries[0].content).toBe('SELECT * FROM loaded_table');
      expect(state.queries[0].filePath).toBe('C:\\loaded.sql');
      expect(state.queries[0].isDirty).toBe(false);
    });
  });
});
