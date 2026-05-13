import * as S from '../schemas';
import { asIpcParams, BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

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

export interface AppSettingsProvider {
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }>;
}

class AppSettingsProviderImpl extends BaseProvider implements AppSettingsProvider {
  async getSettings(): Promise<AppSettings> {
    return this.invokeAndParse('getSettings', {}, S.getSettings);
  }

  async updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }> {
    return this.invokeAndParse('updateSettings', asIpcParams(settings), S.updateSettings);
  }
}

export function createAppSettingsProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): AppSettingsProvider {
  return new AppSettingsProviderImpl(invoker, validator);
}
