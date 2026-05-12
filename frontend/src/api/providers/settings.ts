import * as S from '../schemas';
import { asIpcParams, BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

// ============================================================================
// 設定 (getSettings / updateSettings)
// ============================================================================

export interface AppSettings {
  general: {
    autoConnect: boolean;
    lastConnectionId: string;
    confirmOnExit: boolean;
    maxQueryHistory: number;
    maxRecentConnections: number;
    language: string;
  };
  editor: {
    fontSize: number;
    fontFamily: string;
    wordWrap: boolean;
    tabSize: number;
    insertSpaces: boolean;
    showLineNumbers: boolean;
    showMinimap: boolean;
    theme: string;
  };
  grid: {
    defaultPageSize: number;
    showRowNumbers: boolean;
    enableCellEditing: boolean;
    dateFormat: string;
    nullDisplay: string;
  };
  query: {
    timeoutSeconds: number;
  };
}

export interface UpdateSettingsInput {
  general?: Partial<{
    autoConnect: boolean;
    confirmOnExit: boolean;
    maxQueryHistory: number;
    language: string;
  }>;
  editor?: Partial<{
    fontSize: number;
    fontFamily: string;
    wordWrap: boolean;
    tabSize: number;
    theme: string;
  }>;
  grid?: Partial<{
    defaultPageSize: number;
    showRowNumbers: boolean;
    nullDisplay: string;
  }>;
  query?: Partial<{
    timeoutSeconds: number;
  }>;
  window?: Partial<{
    width: number;
    height: number;
    x: number;
    y: number;
    isMaximized: boolean;
  }>;
}

// ============================================================================
// 接続プロファイル (getConnectionProfiles / saveConnectionProfile / deleteConnectionProfile /
//                 getProfilePassword / getSshPassword / getSshKeyPassphrase)
// ============================================================================

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

// ============================================================================
// セッション (getSessionState / saveSessionState)
// ============================================================================

export interface SessionTab {
  id: string;
  title: string;
  content: string;
  filePath: string;
  isDirty: boolean;
  cursorLine: number;
  cursorColumn: number;
}

export interface SessionState {
  activeConnectionId: string;
  activeTabId: string;
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
  isMaximized: boolean;
  leftPanelWidth: number;
  bottomPanelHeight: number;
  openTabs: SessionTab[];
  expandedTreeNodes: string[];
}

export interface SaveSessionStateInput {
  activeConnectionId?: string;
  activeTabId?: string;
  windowX?: number;
  windowY?: number;
  windowWidth?: number;
  windowHeight?: number;
  isMaximized?: boolean;
  leftPanelWidth?: number;
  bottomPanelHeight?: number;
  openTabs?: SessionTab[];
  expandedTreeNodes?: string[];
}

// ============================================================================
// Provider IF
// ============================================================================

export interface SettingsProvider {
  // 設定
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }>;
  // 接続プロファイル
  getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }>;
  saveConnectionProfile(profile: SaveConnectionProfileInput): Promise<{ id: string }>;
  deleteConnectionProfile(id: string): Promise<{ deleted: boolean }>;
  getProfilePassword(profileId: string): Promise<{ password: string }>;
  getSshPassword(profileId: string): Promise<{ password: string }>;
  getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }>;
  // セッション
  getSessionState(): Promise<SessionState>;
  saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }>;
}

class SettingsProviderImpl extends BaseProvider implements SettingsProvider {
  // ---- 設定 ----

  async getSettings(): Promise<AppSettings> {
    // S.getSettings は z.any() で実質 noop のため parse を省略 (connection.ts と同方針)
    return (await this.invokeRaw('getSettings')) as AppSettings;
  }

  async updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }> {
    return this.invokeAndParse('updateSettings', asIpcParams(settings), S.updateSettings);
  }

  // ---- 接続プロファイル ----

  async getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }> {
    // S.getConnectionProfiles は z.any() で実質 noop のため parse を省略
    return (await this.invokeRaw('getConnectionProfiles')) as {
      profiles: ConnectionProfile[];
    };
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

  // ---- セッション ----

  async getSessionState(): Promise<SessionState> {
    // S.getSessionState は z.any() で実質 noop のため parse を省略
    return (await this.invokeRaw('getSessionState')) as SessionState;
  }

  async saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }> {
    return this.invokeAndParse('saveSessionState', asIpcParams(state), S.saveSessionState);
  }
}

export function createSettingsProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): SettingsProvider {
  return new SettingsProviderImpl(invoker, validator);
}
