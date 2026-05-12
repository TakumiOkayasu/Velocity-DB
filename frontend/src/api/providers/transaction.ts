import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

export interface TransactionProvider {
  beginTransaction(connectionId: string): Promise<void>;
  commit(connectionId: string): Promise<void>;
  rollback(connectionId: string): Promise<void>;
}

class TransactionProviderImpl implements TransactionProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが将来 log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    // 共通シグネチャ維持 (#517 軸③): zVoid のため現状 parse を省略しているが、
    // 将来 structured schema 化された際に差し替えられるよう受け取りは維持する
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
    void this.validator; // TS6138 抑制: 同上
  }

  async beginTransaction(connectionId: string): Promise<void> {
    // S.beginTransaction は z.any() で実質 noop のため parse を省略 (connection.ts と同方針)
    await this.invoker.invoke('beginTransaction', { connectionId });
  }

  async commit(connectionId: string): Promise<void> {
    // S.commit は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('commit', { connectionId });
  }

  async rollback(connectionId: string): Promise<void> {
    // S.rollback は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('rollback', { connectionId });
  }
}

export function createTransactionProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): TransactionProvider {
  return new TransactionProviderImpl(invoker, logger, validator);
}
