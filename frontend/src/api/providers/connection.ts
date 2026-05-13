import type { ConnectResultResponse } from '../schemas';
import * as S from '../schemas';
import { asIpcParams, BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

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

class ConnectionProviderImpl extends BaseProvider implements ConnectionProvider {
  async connectAsync(info: ConnectionInfo): Promise<{ requestId: string }> {
    return this.invokeAndParse('connectAsync', asIpcParams(info), S.connectAsync);
  }

  async getConnectResult(requestId: string): Promise<ConnectResultResponse> {
    return this.invokeAndParse('getConnectResult', { requestId }, S.connectResult);
  }

  async cancelConnect(requestId: string): Promise<void> {
    await this.invokeAndParse('cancelConnect', { requestId }, S.cancelConnect);
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.invokeAndParse('disconnect', { connectionId }, S.disconnect);
  }

  async testConnection(info: TestConnectionInfo): Promise<{ success: boolean; message: string }> {
    return this.invokeAndParse('testConnection', asIpcParams(info), S.testConnection);
  }
}

export function createConnectionProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): ConnectionProvider {
  return new ConnectionProviderImpl(invoker, validator);
}
