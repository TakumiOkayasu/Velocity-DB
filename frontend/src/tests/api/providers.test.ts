import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __getIpcInvokerForTest, __setIpcInvokerForTest } from '../../api/providers';

describe('providers/index', () => {
  beforeEach(() => {
    __setIpcInvokerForTest(new MockIpcInvoker());
  });

  it('__setIpcInvokerForTest で invoker を差し替えられる', () => {
    const mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
    expect(__getIpcInvokerForTest()).toBe(mock);
  });

  it('差し替え後に再度差し替えると最新の invoker が反映される', () => {
    const first = new MockIpcInvoker();
    const second = new MockIpcInvoker();
    __setIpcInvokerForTest(first);
    expect(__getIpcInvokerForTest()).toBe(first);
    __setIpcInvokerForTest(second);
    expect(__getIpcInvokerForTest()).toBe(second);
  });
});

describe('MockIpcInvoker', () => {
  it('setResponse で登録した値を invoke で返す', async () => {
    const mock = new MockIpcInvoker();
    mock.setResponse('connectAsync', { requestId: 'r-1' });
    await expect(mock.invoke('connectAsync', {})).resolves.toEqual({ requestId: 'r-1' });
  });

  it('未登録 method を invoke するとエラーになる', async () => {
    const mock = new MockIpcInvoker();
    await expect(mock.invoke('unknown', {})).rejects.toThrow(/No response registered/);
  });

  it('setError で登録した method はエラーを throw する', async () => {
    const mock = new MockIpcInvoker();
    mock.setError('failingMethod', 'boom');
    await expect(mock.invoke('failingMethod', {})).rejects.toThrow('boom');
  });

  it('呼び出し履歴が calls に記録される', async () => {
    const mock = new MockIpcInvoker();
    mock.setResponse('m', null);
    await mock.invoke('m', { a: 1 });
    await mock.invoke('m', { a: 2 });
    expect(mock.calls).toEqual([
      { method: 'm', params: { a: 1 } },
      { method: 'm', params: { a: 2 } },
    ]);
  });
});
