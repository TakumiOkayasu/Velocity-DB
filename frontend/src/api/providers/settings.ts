import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

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

class SettingsProviderImpl implements SettingsProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが将来 log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
  }

  // ---- 設定 ----

  async getSettings(): Promise<AppSettings> {
    // S.getSettings は z.any() で実質 noop のため parse を省略 (connection.ts と同方針)
    const raw = await this.invoker.invoke('getSettings', {});
    return raw as AppSettings;
  }

  async updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }> {
    const raw = await this.invoker.invoke(
      'updateSettings',
      settings as unknown as Record<string, unknown>
    );
    return this.validator.parse(S.updateSettings, raw);
  }

  // ---- 接続プロファイル ----

  async getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }> {
    // S.getConnectionProfiles は z.any() で実質 noop のため parse を省略
    const raw = await this.invoker.invoke('getConnectionProfiles', {});
    return raw as { profiles: ConnectionProfile[] };
  }

  async saveConnectionProfile(profile: SaveConnectionProfileInput): Promise<{ id: string }> {
    const raw = await this.invoker.invoke(
      'saveConnectionProfile',
      profile as unknown as Record<string, unknown>
    );
    return this.validator.parse(S.saveConnectionProfile, raw);
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    const raw = await this.invoker.invoke('deleteConnectionProfile', { id });
    return this.validator.parse(S.deleteConnectionProfile, raw);
  }

  async getProfilePassword(profileId: string): Promise<{ password: string }> {
    const raw = await this.invoker.invoke('getProfilePassword', { id: profileId });
    return this.validator.parse(S.getProfilePassword, raw);
  }

  async getSshPassword(profileId: string): Promise<{ password: string }> {
    const raw = await this.invoker.invoke('getSshPassword', { id: profileId });
    return this.validator.parse(S.getSshPassword, raw);
  }

  async getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }> {
    const raw = await this.invoker.invoke('getSshKeyPassphrase', { id: profileId });
    return this.validator.parse(S.getSshKeyPassphrase, raw);
  }

  // ---- セッション ----

  async getSessionState(): Promise<SessionState> {
    // S.getSessionState は z.any() で実質 noop のため parse を省略
    const raw = await this.invoker.invoke('getSessionState', {});
    return raw as SessionState;
  }

  async saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }> {
    const raw = await this.invoker.invoke(
      'saveSessionState',
      state as unknown as Record<string, unknown>
    );
    return this.validator.parse(S.saveSessionState, raw);
  }
}

export function createSettingsProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): SettingsProvider {
  return new SettingsProviderImpl(invoker, logger, validator);
}
