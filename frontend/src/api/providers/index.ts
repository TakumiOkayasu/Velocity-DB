import { log } from '../../utils/logger';
import { type IpcInvoker, WindowIpcInvoker } from '../ipc/ipc-invoker';
import { type AppSettingsProvider, createAppSettingsProvider } from './app-settings';
import { type ConnectionProvider, createConnectionProvider } from './connection';
import {
  type ConnectionProfileProvider,
  createConnectionProfileProvider,
} from './connection-profile';
import { createExportProvider, type ExportProvider } from './export';
import { createIoProvider, type IoProvider } from './io';
import { createQueryProvider, type QueryProvider } from './query';
import { createSchemaProvider, type SchemaProvider } from './schema';
import { createSearchProvider, type SearchProvider } from './search';
import { createSessionProvider, type SessionProvider } from './session';
import { createTransactionProvider, type TransactionProvider } from './transaction';
import type { BridgeLogger, ResponseValidator } from './types';
import { createZodValidator } from './validator';

let invokerInstance: IpcInvoker = new WindowIpcInvoker(log);
const loggerInstance: BridgeLogger = log;
const validatorInstance: ResponseValidator = createZodValidator();

interface Providers {
  connection: ConnectionProvider;
  query: QueryProvider;
  schema: SchemaProvider;
  transaction: TransactionProvider;
  exportData: ExportProvider;
  appSettings: AppSettingsProvider;
  connectionProfile: ConnectionProfileProvider;
  session: SessionProvider;
  search: SearchProvider;
  io: IoProvider;
}

function buildProviders(): Providers {
  return {
    connection: createConnectionProvider(invokerInstance, validatorInstance),
    query: createQueryProvider(invokerInstance, validatorInstance),
    schema: createSchemaProvider(invokerInstance, loggerInstance, validatorInstance),
    transaction: createTransactionProvider(invokerInstance, validatorInstance),
    exportData: createExportProvider(invokerInstance, validatorInstance),
    appSettings: createAppSettingsProvider(invokerInstance, validatorInstance),
    connectionProfile: createConnectionProfileProvider(invokerInstance, validatorInstance),
    session: createSessionProvider(invokerInstance, validatorInstance),
    search: createSearchProvider(invokerInstance, validatorInstance),
    io: createIoProvider(invokerInstance, validatorInstance),
  };
}

let providersRef = buildProviders();

// 利用側は `xxxProvider.foo()` でメソッド参照を毎回最新の実体から引く。
// テストで invoker を差し替えた際 (providersRef 再構築) も import 済みコードがそのまま動く。
// メソッドを分割代入後に呼ぶケースでも this を失わないよう関数を実体に bind する。
function makeProviderProxy<K extends keyof Providers>(key: K): Providers[K] {
  return new Proxy({} as Providers[K], {
    get: (_target, prop) => {
      const target = providersRef[key];
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const connectionProvider: ConnectionProvider = makeProviderProxy('connection');
export const queryProvider: QueryProvider = makeProviderProxy('query');
export const schemaProvider: SchemaProvider = makeProviderProxy('schema');
export const transactionProvider: TransactionProvider = makeProviderProxy('transaction');
export const exportProvider: ExportProvider = makeProviderProxy('exportData');
export const appSettingsProvider: AppSettingsProvider = makeProviderProxy('appSettings');
export const connectionProfileProvider: ConnectionProfileProvider =
  makeProviderProxy('connectionProfile');
export const sessionProvider: SessionProvider = makeProviderProxy('session');
export const searchProvider: SearchProvider = makeProviderProxy('search');
export const ioProvider: IoProvider = makeProviderProxy('io');

/** テスト専用: invoker を差し替えて全 provider を再構築する */
export function __setIpcInvokerForTest(invoker: IpcInvoker): void {
  invokerInstance = invoker;
  providersRef = buildProviders();
}

/** テスト専用: 現在の invoker を取得する (DI 検証用) */
export function __getIpcInvokerForTest(): IpcInvoker {
  return invokerInstance;
}
