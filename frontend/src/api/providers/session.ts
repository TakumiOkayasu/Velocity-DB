import * as S from '../schemas';
import { asIpcParams, BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

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

export interface SessionProvider {
  getSessionState(): Promise<SessionState>;
  saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }>;
}

class SessionProviderImpl extends BaseProvider implements SessionProvider {
  async getSessionState(): Promise<SessionState> {
    return this.invokeAndParse('getSessionState', {}, S.getSessionState);
  }

  async saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }> {
    return this.invokeAndParse('saveSessionState', asIpcParams(state), S.saveSessionState);
  }
}

export function createSessionProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): SessionProvider {
  return new SessionProviderImpl(invoker, validator);
}
