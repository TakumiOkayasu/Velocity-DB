import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  DEFAULT_QUERY_TIMEOUT_MS,
  executeAsyncWithPolling,
} from '../../store/query/helpers/asyncPolling';
import type { QueryBridgeable } from '../../store/query/interfaces/QueryBridgeable';

function createMockBridge(overrides: Partial<QueryBridgeable> = {}): QueryBridgeable {
  return {
    executeAsyncQuery: vi.fn().mockResolvedValue({ queryId: 'q1' }),
    getAsyncQueryResult: vi.fn().mockResolvedValue({ status: 'pending' }),
    cancelAsyncQuery: vi.fn().mockResolvedValue({ cancelled: true }),
    removeAsyncQuery: vi.fn().mockResolvedValue({ removed: true }),
    cancelQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('executeAsyncWithPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should cancel via AbortSignal during IPC blocking', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    // getAsyncQueryResult never resolves (simulates IPC block)
    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    const promise = executeAsyncWithPolling(bridge, 'conn1', 'SELECT 1', controller.signal);

    // Abort while IPC is blocking (use microtask to ensure promise.race is set up)
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toThrow('Query cancelled');
    expect(bridge.removeAsyncQuery).toHaveBeenCalledWith('q1');
  });

  it('should call onQueryIdReady with queryId', async () => {
    const onReady = vi.fn();
    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockResolvedValue({
        status: 'completed',
        columns: [],
        rows: [],
        affectedRows: 0,
        executionTimeMs: 1,
      }),
    });

    await executeAsyncWithPolling(bridge, 'conn1', 'SELECT 1', undefined, onReady);

    expect(onReady).toHaveBeenCalledWith('q1');
  });

  it('should use custom timeoutMs', async () => {
    vi.useRealTimers();

    // Mock Date.now to simulate elapsed time
    let callCount = 0;
    const originalDateNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call returns base time, subsequent calls exceed timeout
      return callCount <= 1 ? originalDateNow() : originalDateNow() + 600;
    });

    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockResolvedValue({ status: 'pending' }),
    });

    await expect(
      executeAsyncWithPolling(bridge, 'conn1', 'SELECT 1', undefined, undefined, 500)
    ).rejects.toThrow('timed out after 1 seconds');
    expect(bridge.cancelAsyncQuery).toHaveBeenCalledWith('q1');

    vi.restoreAllMocks();
  });

  it('should use DEFAULT_QUERY_TIMEOUT_MS when timeoutMs is not provided', () => {
    expect(DEFAULT_QUERY_TIMEOUT_MS).toBe(300000);
  });

  it('should complete successfully on status completed', async () => {
    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockResolvedValue({
        status: 'completed',
        columns: [{ name: 'id', type: 'int' }],
        rows: [[1]],
        affectedRows: 1,
        executionTimeMs: 10,
      }),
    });

    const result = await executeAsyncWithPolling(bridge, 'conn1', 'SELECT 1');

    expect('columns' in result).toBe(true);
    if ('columns' in result) {
      expect(result.columns).toHaveLength(1);
      expect(result.rows).toEqual([[1]]);
    }
  });

  it('should throw on status failed', async () => {
    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockResolvedValue({
        status: 'failed',
        error: 'Syntax error',
      }),
    });

    await expect(executeAsyncWithPolling(bridge, 'conn1', 'BAD SQL')).rejects.toThrow(
      'Syntax error'
    );
  });

  it('should throw on status cancelled', async () => {
    const bridge = createMockBridge({
      getAsyncQueryResult: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    });

    await expect(executeAsyncWithPolling(bridge, 'conn1', 'SELECT 1')).rejects.toThrow(
      'Query was cancelled'
    );
  });
});
