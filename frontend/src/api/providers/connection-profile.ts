import * as S from '../schemas';
import { asIpcParams, BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

export interface ConnectionProfile {
  id: string;
  name: string;
  server: string;
  port?: number;
  database: string;
  username: string;
  useWindowsAuth: boolean;
  savePassword?: boolean;
  isProduction?: boolean;
  isReadOnly?: boolean;
  environment?: 'development' | 'staging' | 'production';
  dbType?: 'sqlserver' | 'postgresql' | 'mysql';
  folderPath?: string;
  ssh?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'privateKey';
    privateKeyPath: string;
    savePassword: boolean;
  };
}

export interface SaveConnectionProfileInput {
  id?: string;
  name: string;
  server: string;
  port?: number;
  database: string;
  username?: string;
  useWindowsAuth: boolean;
  savePassword?: boolean;
  password?: string;
  isProduction?: boolean;
  isReadOnly?: boolean;
  environment?: 'development' | 'staging' | 'production';
  dbType?: 'sqlserver' | 'postgresql' | 'mysql';
  folderPath?: string;
  ssh?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'privateKey';
    privateKeyPath?: string;
    savePassword?: boolean;
    password?: string;
    keyPassphrase?: string;
  };
}

export interface ConnectionProfileProvider {
  getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }>;
  saveConnectionProfile(profile: SaveConnectionProfileInput): Promise<{ id: string }>;
  deleteConnectionProfile(id: string): Promise<{ deleted: boolean }>;
  getProfilePassword(profileId: string): Promise<{ password: string }>;
  getSshPassword(profileId: string): Promise<{ password: string }>;
  getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }>;
}

class ConnectionProfileProviderImpl extends BaseProvider implements ConnectionProfileProvider {
  async getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }> {
    return this.invokeAndParse('getConnectionProfiles', {}, S.getConnectionProfiles);
  }

  async saveConnectionProfile(profile: SaveConnectionProfileInput): Promise<{ id: string }> {
    return this.invokeAndParse(
      'saveConnectionProfile',
      asIpcParams(profile),
      S.saveConnectionProfile
    );
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    return this.invokeAndParse('deleteConnectionProfile', { id }, S.deleteConnectionProfile);
  }

  async getProfilePassword(profileId: string): Promise<{ password: string }> {
    return this.invokeAndParse('getProfilePassword', { id: profileId }, S.getProfilePassword);
  }

  async getSshPassword(profileId: string): Promise<{ password: string }> {
    return this.invokeAndParse('getSshPassword', { id: profileId }, S.getSshPassword);
  }

  async getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }> {
    return this.invokeAndParse('getSshKeyPassphrase', { id: profileId }, S.getSshKeyPassphrase);
  }
}

export function createConnectionProfileProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): ConnectionProfileProvider {
  return new ConnectionProfileProviderImpl(invoker, validator);
}
