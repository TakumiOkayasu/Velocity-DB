import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

export interface TransactionProvider {
  beginTransaction(connectionId: string): Promise<void>;
  commit(connectionId: string): Promise<void>;
  rollback(connectionId: string): Promise<void>;
}

class TransactionProviderImpl extends BaseProvider implements TransactionProvider {
  async beginTransaction(connectionId: string): Promise<void> {
    await this.invokeAndParse('beginTransaction', { connectionId }, S.beginTransaction);
  }

  async commit(connectionId: string): Promise<void> {
    await this.invokeAndParse('commit', { connectionId }, S.commit);
  }

  async rollback(connectionId: string): Promise<void> {
    await this.invokeAndParse('rollback', { connectionId }, S.rollback);
  }
}

export function createTransactionProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): TransactionProvider {
  return new TransactionProviderImpl(invoker, validator);
}
