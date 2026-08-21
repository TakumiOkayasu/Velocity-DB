import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { toQueryResult } from '../../store/query/helpers/asyncPolling';
import {
  type ExecutionFields,
  endExecution,
  failExecution,
  generateQueryId,
  getQueryCounter,
  resetQueryCounter,
  startExecution,
} from '../../store/query/helpers/executionState';
import type { AsyncPollResult } from '../../types';

function makeState(overrides?: Partial<ExecutionFields>): ExecutionFields {
  return {
    executingQueryIds: new Set<string>(),
    errors: {},
    isExecuting: false,
    ...overrides,
  };
}

describe('executionState helpers', () => {
  describe('generateQueryId / resetQueryCounter', () => {
    beforeEach(() => {
      resetQueryCounter();
    });

    it('should generate incrementing ids', () => {
      expect(generateQueryId()).toBe('query-1');
      expect(generateQueryId()).toBe('query-2');
      expect(getQueryCounter()).toBe(2);
    });

    it('should reset counter', () => {
      generateQueryId();
      generateQueryId();
      resetQueryCounter();
      expect(getQueryCounter()).toBe(0);
      expect(generateQueryId()).toBe('query-1');
    });
  });

  describe('startExecution', () => {
    it('should add id to executingQueryIds and clear error', () => {
      const state = makeState({ errors: { 'q-1': 'old error' } });
      const result = startExecution(state, 'q-1');

      expect(result.executingQueryIds?.has('q-1')).toBe(true);
      expect(result.errors?.['q-1']).toBeNull();
      expect(result.isExecuting).toBe(true);
    });

    it('should preserve other executing ids', () => {
      const state = makeState({ executingQueryIds: new Set(['q-1']) });
      const result = startExecution(state, 'q-2');

      expect(result.executingQueryIds?.has('q-1')).toBe(true);
      expect(result.executingQueryIds?.has('q-2')).toBe(true);
    });
  });

  describe('endExecution', () => {
    it('should remove id and set isExecuting to false when empty', () => {
      const state = makeState({ executingQueryIds: new Set(['q-1']), isExecuting: true });
      const result = endExecution(state, 'q-1');

      expect(result.executingQueryIds?.has('q-1')).toBe(false);
      expect(result.isExecuting).toBe(false);
    });

    it('should keep isExecuting true when other queries remain', () => {
      const state = makeState({ executingQueryIds: new Set(['q-1', 'q-2']), isExecuting: true });
      const result = endExecution(state, 'q-1');

      expect(result.executingQueryIds?.has('q-2')).toBe(true);
      expect(result.isExecuting).toBe(true);
    });
  });

  describe('failExecution', () => {
    it('should end execution and set error', () => {
      const state = makeState({ executingQueryIds: new Set(['q-1']), isExecuting: true });
      const result = failExecution(state, 'q-1', 'Something broke');

      expect(result.executingQueryIds?.has('q-1')).toBe(false);
      expect(result.isExecuting).toBe(false);
      expect(result.errors?.['q-1']).toBe('Something broke');
    });
  });
});

describe('toQueryResult', () => {
  it('should convert single result', () => {
    const pollResult: AsyncPollResult = {
      columns: [{ name: 'id', type: 'int', comment: 'ID列' }],
      rows: [['1'], ['2']],
      affectedRows: 0,
      executionTimeMs: 50,
    };

    const queryResult = toQueryResult(pollResult);

    expect('columns' in queryResult && queryResult.columns[0].name).toBe('id');
    expect('columns' in queryResult && queryResult.columns[0].comment).toBe('ID列');
    expect('columns' in queryResult && queryResult.columns[0].size).toBe(0);
    expect('rows' in queryResult && queryResult.rows).toHaveLength(2);
    expect('affectedRows' in queryResult && queryResult.affectedRows).toBe(0);
    expect('executionTimeMs' in queryResult && queryResult.executionTimeMs).toBe(50);
  });

  it('should convert multiple results', () => {
    const pollResult: AsyncPollResult = {
      multipleResults: true,
      results: [
        {
          statement: 'SELECT 1',
          data: {
            columns: [{ name: 'a', type: 'int' }],
            rows: [['1']],
            affectedRows: 5,
            executionTimeMs: 10,
          },
        },
        {
          statement: 'SELECT 2',
          data: {
            columns: [{ name: 'b', type: 'varchar' }],
            rows: [['x']],
            affectedRows: 3,
            executionTimeMs: 20,
          },
        },
      ],
    };

    const queryResult = toQueryResult(pollResult);

    expect('multipleResults' in queryResult && queryResult.multipleResults).toBe(true);
  });

  it('should map comment field through mapAsyncColumn', () => {
    const pollResult: AsyncPollResult = {
      columns: [{ name: 'user_name', type: 'nvarchar', comment: 'ユーザー名' }],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
    };

    const queryResult = toQueryResult(pollResult);
    const col = 'columns' in queryResult ? queryResult.columns[0] : null;
    expect(col?.comment).toBe('ユーザー名');
    expect(col?.nullable).toBe(true);
    expect(col?.isPrimaryKey).toBe(false);
  });
});
