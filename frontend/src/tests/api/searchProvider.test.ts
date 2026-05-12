import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, searchProvider } from '../../api/providers';
import type { SearchObjectResult } from '../../api/providers/search';

const SAMPLE_RESULT: SearchObjectResult = {
  objectType: 'TABLE',
  schemaName: 'dbo',
  objectName: 'users',
  parentName: '',
};

describe('searchProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  describe('searchObjects', () => {
    it('options 無し: connectionId と pattern を渡し配列を返す', async () => {
      mock.setResponse('searchObjects', [SAMPLE_RESULT]);

      const result = await searchProvider.searchObjects('c-1', 'user');

      expect(mock.calls[0]).toEqual({
        method: 'searchObjects',
        params: { connectionId: 'c-1', pattern: 'user' },
      });
      expect(result).toEqual([SAMPLE_RESULT]);
    });

    it('options 有り: options を spread して IPC に渡す', async () => {
      mock.setResponse('searchObjects', [SAMPLE_RESULT]);

      const result = await searchProvider.searchObjects('c-1', 'user', {
        searchTables: true,
        searchViews: false,
        caseSensitive: true,
        maxResults: 50,
      });

      expect(mock.calls[0]).toEqual({
        method: 'searchObjects',
        params: {
          connectionId: 'c-1',
          pattern: 'user',
          searchTables: true,
          searchViews: false,
          caseSensitive: true,
          maxResults: 50,
        },
      });
      expect(result).toEqual([SAMPLE_RESULT]);
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('searchObjects', [{ objectType: 'TABLE' }]);

      await expect(searchProvider.searchObjects('c-1', 'user')).rejects.toThrow();
    });
  });

  describe('quickSearch', () => {
    it('limit 省略時に既定値 20 を渡し string 配列を返す', async () => {
      mock.setResponse('quickSearch', ['users', 'user_roles']);

      const result = await searchProvider.quickSearch('c-1', 'us');

      expect(mock.calls[0]).toEqual({
        method: 'quickSearch',
        params: { connectionId: 'c-1', prefix: 'us', limit: 20 },
      });
      expect(result).toEqual(['users', 'user_roles']);
    });

    it('limit 明示指定時にその値を渡す', async () => {
      mock.setResponse('quickSearch', []);

      await searchProvider.quickSearch('c-1', 'us', 5);

      expect(mock.calls[0]).toEqual({
        method: 'quickSearch',
        params: { connectionId: 'c-1', prefix: 'us', limit: 5 },
      });
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('quickSearch', [1, 2, 3]);

      await expect(searchProvider.quickSearch('c-1', 'us')).rejects.toThrow();
    });
  });

  describe('エラー伝播', () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['searchObjects', () => searchProvider.searchObjects('c-1', 'user')],
      ['quickSearch', () => searchProvider.quickSearch('c-1', 'us')],
    ];

    it.each(cases)('%s: IPC エラーを呼出側に伝播する', async (method, call) => {
      mock.setError(method, `${method} failed`);

      await expect(call()).rejects.toThrow(`${method} failed`);
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('quickSearch', []);
    const { quickSearch } = searchProvider;

    await quickSearch('c-1', 'us');

    expect(mock.calls[0]?.method).toBe('quickSearch');
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('quickSearch', []);
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('quickSearch', []);
    __setIpcInvokerForTest(second);

    await searchProvider.quickSearch('c-1', 'us');

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
