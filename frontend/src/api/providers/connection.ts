import type { ConnectResultResponse } from '../schemas';
import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

interface SshConnectInfo {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: string;
  password?: string;
  privateKeyPath?: string;
  keyPassphrase?: string;
}

export interface ConnectionInfo {
  server: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  useWindowsAuth: boolean;
  connectionTimeout?: number;
  dbType?: 'sqlserver' | 'postgresql' | 'mysql';
  ssh?: SshConnectInfo;
}

export type TestConnectionInfo = Omit<ConnectionInfo, 'connectionTimeout'>;

export interface ConnectionProvider {
  connectAsync(info: ConnectionInfo): Promise<{ requestId: string }>;
  getConnectResult(requestId: string): Promise<ConnectResultResponse>;
  cancelConnect(requestId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  testConnection(info: TestConnectionInfo): Promise<{ success: boolean; message: string }>;
}

class ConnectionProviderImpl implements ConnectionProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが #520+ で log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
  }

  async connectAsync(info: ConnectionInfo): Promise<{ requestId: string }> {
    const raw = await this.invoker.invoke(
      'connectAsync',
      info as unknown as Record<string, unknown>
    );
    return this.validator.parse(S.connectAsync, raw);
  }

  async getConnectResult(requestId: string): Promise<ConnectResultResponse> {
    const raw = await this.invoker.invoke('getConnectResult', { requestId });
    return this.validator.parse(S.connectResult, raw);
  }

  async cancelConnect(requestId: string): Promise<void> {
    // S.cancelConnect は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('cancelConnect', { requestId });
  }

  async disconnect(connectionId: string): Promise<void> {
    // S.disconnect は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('disconnect', { connectionId });
  }

  async testConnection(info: TestConnectionInfo): Promise<{ success: boolean; message: string }> {
    const raw = await this.invoker.invoke(
      'testConnection',
      info as unknown as Record<string, unknown>
    );
    return this.validator.parse(S.testConnection, raw);
  }
}

export function createConnectionProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): ConnectionProvider {
  return new ConnectionProviderImpl(invoker, logger, validator);
}
