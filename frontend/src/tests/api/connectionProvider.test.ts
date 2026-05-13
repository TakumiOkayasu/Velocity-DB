import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, connectionProvider } from '../../api/providers';

describe('connectionProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  it('connectAsync は IPC を呼び出し schema parse 済みの値を返す', async () => {
    mock.setResponse('connectAsync', { requestId: 'r-1' });

    const result = await connectionProvider.connectAsync({
      server: 'localhost',
      database: 'db1',
      useWindowsAuth: true,
    });

    expect(result).toEqual({ requestId: 'r-1' });
    expect(mock.calls[0]?.method).toBe('connectAsync');
    expect(mock.calls[0]?.params).toMatchObject({ server: 'localhost', database: 'db1' });
  });

  it('connectAsync が schema 不一致のレスポンスを受け取ると throw する', async () => {
    mock.setResponse('connectAsync', { wrongField: 'oops' });

    await expect(
      connectionProvider.connectAsync({
        server: 'localhost',
        database: 'db1',
        useWindowsAuth: true,
      })
    ).rejects.toThrow();
  });

  it('getConnectResult は requestId を渡し ConnectResultResponse を返す', async () => {
    mock.setResponse('getConnectResult', { status: 'connected', connectionId: 'c-1' });

    const result = await connectionProvider.getConnectResult('req-1');

    expect(result).toEqual({ status: 'connected', connectionId: 'c-1' });
    expect(mock.calls[0]).toEqual({ method: 'getConnectResult', params: { requestId: 'req-1' } });
  });

  it('cancelConnect は IPC を呼び出す', async () => {
    mock.setResponse('cancelConnect', {});

    await connectionProvider.cancelConnect('req-1');

    expect(mock.calls[0]).toEqual({ method: 'cancelConnect', params: { requestId: 'req-1' } });
  });

  it('disconnect は connectionId を渡す', async () => {
    mock.setResponse('disconnect', {});

    await connectionProvider.disconnect('conn-1');

    expect(mock.calls[0]).toEqual({ method: 'disconnect', params: { connectionId: 'conn-1' } });
  });

  it('testConnection は success/message を schema parse して返す', async () => {
    mock.setResponse('testConnection', { success: true, message: 'ok' });

    const result = await connectionProvider.testConnection({
      server: 'localhost',
      database: 'db1',
      useWindowsAuth: true,
    });

    expect(result).toEqual({ success: true, message: 'ok' });
    expect(mock.calls[0]?.method).toBe('testConnection');
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('testConnection', { success: true, message: 'ok' });

    const { testConnection } = connectionProvider;
    const result = await testConnection({
      server: 'localhost',
      database: 'db1',
      useWindowsAuth: true,
    });

    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('connectAsync', { requestId: 'first' });
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('connectAsync', { requestId: 'second' });
    __setIpcInvokerForTest(second);

    const result = await connectionProvider.connectAsync({
      server: 's',
      database: 'd',
      useWindowsAuth: true,
    });

    expect(result.requestId).toBe('second');
    expect(first.calls).toHaveLength(0);
  });
});
