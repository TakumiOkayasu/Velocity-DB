import type { IpcInvoker } from './types';

// 全 method の schema が zVoid (parse 不要) のため BaseProvider は継承しない。
// validator を持たず invoker のみで完結する設計 (export.ts と同方針)。

export interface TransactionProvider {
  beginTransaction(connectionId: string): Promise<void>;
  commit(connectionId: string): Promise<void>;
  rollback(connectionId: string): Promise<void>;
}

class TransactionProviderImpl implements TransactionProvider {
  constructor(private readonly invoker: IpcInvoker) {}

  async beginTransaction(connectionId: string): Promise<void> {
    // S.beginTransaction は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('beginTransaction', { connectionId });
  }

  async commit(connectionId: string): Promise<void> {
    await this.invoker.invoke('commit', { connectionId });
  }

  async rollback(connectionId: string): Promise<void> {
    await this.invoker.invoke('rollback', { connectionId });
  }
}

export function createTransactionProvider(invoker: IpcInvoker): TransactionProvider {
  return new TransactionProviderImpl(invoker);
}
