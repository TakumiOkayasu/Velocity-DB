import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/mockSettingsUtils';
import { useQueryStore } from '../../store/queryStore';

vi.mock('../../api/bridge', () => ({
  bridge: {
    executeAsyncQuery: vi.fn(),
    getAsyncQueryResult: vi.fn(),
    cancelAsyncQuery: vi.fn(),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    lintSql: vi.fn().mockResolvedValue({ diagnostics: [], lintUnavailable: true }),
    getColumns: vi.fn(),
    cancelQuery: vi.fn(),
  },
}));

import { bridge } from '../../api/bridge';

const mockedBridge = vi.mocked(bridge);

describe('runtimeDiagnostics', () => {
  beforeEach(() => {
    useQueryStore.setState({
      queries: [],
      activeQueryId: null,
      results: {},
      executingQueryIds: new Set<string>(),
      errors: {},
      lintDiagnostics: {},
      runtimeDiagnostics: {},
      paginationStates: {},
      isExecuting: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SQL Server形式の実行エラー(Line N)からrow markerをセットする', async () => {
    mockedBridge.executeAsyncQuery.mockRejectedValue(
      new Error("Msg 208, Level 16, State 1, Line 3\nInvalid object name 'x'.")
    );
    const { addQuery, executeQuery, updateQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT 1');

    await executeQuery(queryId, 'conn_1');

    const { runtimeDiagnostics } = useQueryStore.getState();
    expect(runtimeDiagnostics[queryId]).toEqual([
      expect.objectContaining({ line: 3, column: 1, message: "Invalid object name 'x'." }),
    ]);
  });

  it('行情報がないエラーではruntimeDiagnosticsを追加しない', async () => {
    mockedBridge.executeAsyncQuery.mockRejectedValue(new Error('random failure'));
    const { addQuery, executeQuery, updateQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT 1');

    await executeQuery(queryId, 'conn_1');

    const { runtimeDiagnostics } = useQueryStore.getState();
    expect(runtimeDiagnostics[queryId] ?? []).toEqual([]);
  });

  it('再実行開始時に古いruntime markerをクリアする', async () => {
    const { addQuery, executeQuery, updateQuery } = useQueryStore.getState();
    addQuery('conn_1');
    const queryId = useQueryStore.getState().queries[0].id;
    updateQuery(queryId, 'SELECT 1');

    // 1回目: エラーでmarkerセット
    mockedBridge.executeAsyncQuery.mockRejectedValueOnce(
      new Error('Msg 100, Level 16, State 1, Line 5\nerr')
    );
    await executeQuery(queryId, 'conn_1');
    expect(useQueryStore.getState().runtimeDiagnostics[queryId]?.length).toBe(1);

    // 2回目: 実行開始時にクリアされてから成功
    mockedBridge.executeAsyncQuery.mockResolvedValueOnce({ queryId: 'async_1' });
    mockedBridge.getAsyncQueryResult.mockResolvedValueOnce({
      queryId: 'async_1',
      status: 'completed',
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      truncated: false,
    });
    await executeQuery(queryId, 'conn_1');
    expect(useQueryStore.getState().runtimeDiagnostics[queryId]).toEqual([]);
  });
});
