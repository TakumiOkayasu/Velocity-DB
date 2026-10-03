import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

export interface TransactionProvider {
  getTransactionState(connectionId: string): Promise<{ active: boolean; busy: boolean }>;
  beginTransaction(connectionId: string): Promise<void>;
  commit(connectionId: string): Promise<void>;
  rollback(connectionId: string): Promise<void>;
}

class TransactionProviderImpl extends BaseProvider implements TransactionProvider {
  async getTransactionState(connectionId: string): Promise<{ active: boolean; busy: boolean }> {
    return this.invokeAndParse('getTransactionState', { connectionId }, S.getTransactionState);
  }

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
