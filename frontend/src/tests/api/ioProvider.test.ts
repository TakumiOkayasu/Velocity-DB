import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, ioProvider } from '../../api/providers';
import type { Bookmark } from '../../api/providers/io';

const SAMPLE_BOOKMARKS: Bookmark[] = [
  { id: 'b1', name: 'list-users', content: 'SELECT * FROM users' },
  { id: 'b2', name: 'count-orders', content: 'SELECT COUNT(*) FROM orders' },
];

describe('ioProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  describe('writeFrontendLog', () => {
    it('content を渡し IPC を呼ぶ', async () => {
      mock.setResponse('writeFrontendLog', {});

      await ioProvider.writeFrontendLog('log entry');

      expect(mock.calls[0]).toEqual({
        method: 'writeFrontendLog',
        params: { content: 'log entry' },
      });
    });
  });

  describe('saveQueryToFile', () => {
    it('defaultFileName 省略時にも IPC を呼び filePath を返す', async () => {
      mock.setResponse('saveQueryToFile', { filePath: 'C:/tmp/q.sql' });

      const result = await ioProvider.saveQueryToFile('SELECT 1');

      expect(mock.calls[0]).toEqual({
        method: 'saveQueryToFile',
        params: { content: 'SELECT 1', defaultFileName: undefined },
      });
      expect(result).toEqual({ filePath: 'C:/tmp/q.sql' });
    });

    it('defaultFileName 明示時にその値を渡す', async () => {
      mock.setResponse('saveQueryToFile', { filePath: 'C:/tmp/named.sql' });

      await ioProvider.saveQueryToFile('SELECT 1', 'named.sql');

      expect(mock.calls[0]).toEqual({
        method: 'saveQueryToFile',
        params: { content: 'SELECT 1', defaultFileName: 'named.sql' },
      });
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('saveQueryToFile', { wrong: 'shape' });

      await expect(ioProvider.saveQueryToFile('SELECT 1')).rejects.toThrow();
    });
  });

  describe('loadQueryFromFile', () => {
    it('引数無しで IPC を呼び filePath と content を返す', async () => {
      mock.setResponse('loadQueryFromFile', { filePath: 'C:/q.sql', content: 'SELECT 1' });

      const result = await ioProvider.loadQueryFromFile();

      expect(mock.calls[0]).toEqual({ method: 'loadQueryFromFile', params: {} });
      expect(result).toEqual({ filePath: 'C:/q.sql', content: 'SELECT 1' });
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('loadQueryFromFile', { filePath: 'C:/q.sql' });

      await expect(ioProvider.loadQueryFromFile()).rejects.toThrow();
    });
  });

  describe('browseFile', () => {
    it('filter 省略時にも IPC を呼び filePath を返す', async () => {
      mock.setResponse('browseFile', { filePath: 'C:/key.pem' });

      const result = await ioProvider.browseFile();

      expect(mock.calls[0]).toEqual({
        method: 'browseFile',
        params: { filter: undefined },
      });
      expect(result).toEqual({ filePath: 'C:/key.pem' });
    });

    it('filter 明示時にその値を渡す', async () => {
      mock.setResponse('browseFile', { filePath: 'C:/key.pem' });

      await ioProvider.browseFile('PEM Files (*.pem)|*.pem');

      expect(mock.calls[0]).toEqual({
        method: 'browseFile',
        params: { filter: 'PEM Files (*.pem)|*.pem' },
      });
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('browseFile', {});

      await expect(ioProvider.browseFile()).rejects.toThrow();
    });
  });

  describe('getBookmarks', () => {
    it('IPC を呼び Bookmark 配列を返す', async () => {
      mock.setResponse('getBookmarks', SAMPLE_BOOKMARKS);

      const result = await ioProvider.getBookmarks();

      expect(mock.calls[0]).toEqual({ method: 'getBookmarks', params: {} });
      expect(result).toEqual(SAMPLE_BOOKMARKS);
    });

    it('schema 不一致時に throw する', async () => {
      mock.setResponse('getBookmarks', [{ id: 'b1' }]);

      await expect(ioProvider.getBookmarks()).rejects.toThrow();
    });
  });

  describe('saveBookmark', () => {
    it('id / name / content を渡し IPC を呼ぶ', async () => {
      mock.setResponse('saveBookmark', {});

      await ioProvider.saveBookmark('b1', 'list-users', 'SELECT * FROM users');

      expect(mock.calls[0]).toEqual({
        method: 'saveBookmark',
        params: { id: 'b1', name: 'list-users', content: 'SELECT * FROM users' },
      });
    });
  });

  describe('deleteBookmark', () => {
    it('id を渡し IPC を呼ぶ', async () => {
      mock.setResponse('deleteBookmark', {});

      await ioProvider.deleteBookmark('b1');

      expect(mock.calls[0]).toEqual({ method: 'deleteBookmark', params: { id: 'b1' } });
    });
  });

  describe('エラー伝播', () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['writeFrontendLog', () => ioProvider.writeFrontendLog('x')],
      ['saveQueryToFile', () => ioProvider.saveQueryToFile('SELECT 1')],
      ['loadQueryFromFile', () => ioProvider.loadQueryFromFile()],
      ['browseFile', () => ioProvider.browseFile()],
      ['getBookmarks', () => ioProvider.getBookmarks()],
      ['saveBookmark', () => ioProvider.saveBookmark('b1', 'n', 'c')],
      ['deleteBookmark', () => ioProvider.deleteBookmark('b1')],
    ];

    it.each(cases)('%s: IPC エラーを呼出側に伝播する', async (method, call) => {
      mock.setError(method, `${method} failed`);

      await expect(call()).rejects.toThrow(`${method} failed`);
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('getBookmarks', []);
    const { getBookmarks } = ioProvider;

    await getBookmarks();

    expect(mock.calls[0]?.method).toBe('getBookmarks');
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('getBookmarks', []);
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('getBookmarks', []);
    __setIpcInvokerForTest(second);

    await ioProvider.getBookmarks();

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
