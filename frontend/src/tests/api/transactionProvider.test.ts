import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, transactionProvider } from '../../api/providers';
import type { TransactionProvider } from '../../api/providers/transaction';

type TxMethod = keyof TransactionProvider;
const TX_METHODS: readonly TxMethod[] = ['beginTransaction', 'commit', 'rollback'] as const;

describe('transactionProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  describe.each(TX_METHODS)('%s', (method) => {
    it('IPC を呼び connectionId を渡す', async () => {
      mock.setResponse(method, null);

      await transactionProvider[method]('conn-1');

      expect(mock.calls[0]).toEqual({ method, params: { connectionId: 'conn-1' } });
    });

    it('IPC エラー時に throw する', async () => {
      mock.setError(method, `${method} failed`);

      await expect(transactionProvider[method]('conn-1')).rejects.toThrow(`${method} failed`);
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('beginTransaction', null);
    const { beginTransaction } = transactionProvider;

    await beginTransaction('conn-1');

    expect(mock.calls[0]?.method).toBe('beginTransaction');
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('commit', null);
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('commit', null);
    __setIpcInvokerForTest(second);

    await transactionProvider.commit('conn-1');

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
