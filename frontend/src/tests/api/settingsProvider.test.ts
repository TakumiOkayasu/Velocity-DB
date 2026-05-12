import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, settingsProvider } from '../../api/providers';
import type {
  AppSettings,
  ConnectionProfile,
  SaveConnectionProfileInput,
  SaveSessionStateInput,
  SessionState,
  UpdateSettingsInput,
} from '../../api/providers/settings';

const SAMPLE_SETTINGS: AppSettings = {
  general: {
    autoConnect: true,
    lastConnectionId: 'conn-1',
    confirmOnExit: false,
    maxQueryHistory: 100,
    maxRecentConnections: 10,
    language: 'ja',
  },
  editor: {
    fontSize: 14,
    fontFamily: 'Consolas',
    wordWrap: true,
    tabSize: 2,
    insertSpaces: true,
    showLineNumbers: true,
    showMinimap: false,
    theme: 'dark',
  },
  grid: {
    defaultPageSize: 50,
    showRowNumbers: true,
    enableCellEditing: true,
    dateFormat: 'YYYY-MM-DD',
    nullDisplay: '(null)',
  },
  query: {
    timeoutSeconds: 30,
  },
};

const SAMPLE_PROFILE: ConnectionProfile = {
  id: 'p-1',
  name: 'dev',
  server: 'localhost',
  database: 'test',
  username: 'sa',
  useWindowsAuth: false,
};

const SAMPLE_SAVE_PROFILE: SaveConnectionProfileInput = {
  name: 'dev',
  server: 'localhost',
  database: 'test',
  useWindowsAuth: false,
};

const SAMPLE_SESSION: SessionState = {
  activeConnectionId: 'conn-1',
  activeTabId: 'tab-1',
  windowX: 0,
  windowY: 0,
  windowWidth: 1280,
  windowHeight: 720,
  isMaximized: false,
  leftPanelWidth: 240,
  bottomPanelHeight: 200,
  openTabs: [
    {
      id: 'tab-1',
      title: 'q1.sql',
      content: 'SELECT 1',
      filePath: '',
      isDirty: false,
      cursorLine: 0,
      cursorColumn: 0,
    },
  ],
  expandedTreeNodes: ['db.public'],
};

const SAMPLE_SAVE_SESSION: SaveSessionStateInput = {
  activeConnectionId: 'conn-1',
};

const SAMPLE_UPDATE_SETTINGS: UpdateSettingsInput = {
  general: { autoConnect: false },
};

describe('settingsProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  describe('設定 (getSettings / updateSettings)', () => {
    it('getSettings: IPC を呼び戻り値を返す', async () => {
      mock.setResponse('getSettings', SAMPLE_SETTINGS);

      const result = await settingsProvider.getSettings();

      expect(mock.calls[0]).toEqual({ method: 'getSettings', params: {} });
      expect(result).toEqual(SAMPLE_SETTINGS);
    });

    it('updateSettings: IPC に引数を渡し saved を返す', async () => {
      mock.setResponse('updateSettings', { saved: true });

      const result = await settingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS);

      expect(mock.calls[0]).toEqual({
        method: 'updateSettings',
        params: SAMPLE_UPDATE_SETTINGS,
      });
      expect(result).toEqual({ saved: true });
    });

    it('updateSettings: schema 不一致時に throw する', async () => {
      mock.setResponse('updateSettings', { saved: 'true' });

      await expect(settingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS)).rejects.toThrow();
    });
  });

  describe('接続プロファイル', () => {
    it('getConnectionProfiles: IPC を呼び profiles を返す', async () => {
      mock.setResponse('getConnectionProfiles', { profiles: [SAMPLE_PROFILE] });

      const result = await settingsProvider.getConnectionProfiles();

      expect(mock.calls[0]).toEqual({ method: 'getConnectionProfiles', params: {} });
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]).toEqual(SAMPLE_PROFILE);
    });

    it('saveConnectionProfile: IPC を呼び id を返す', async () => {
      mock.setResponse('saveConnectionProfile', { id: 'p-new' });

      const result = await settingsProvider.saveConnectionProfile(SAMPLE_SAVE_PROFILE);

      expect(mock.calls[0]).toEqual({
        method: 'saveConnectionProfile',
        params: SAMPLE_SAVE_PROFILE,
      });
      expect(result).toEqual({ id: 'p-new' });
    });

    it('deleteConnectionProfile: id を {id} として渡し deleted を返す', async () => {
      mock.setResponse('deleteConnectionProfile', { deleted: true });

      const result = await settingsProvider.deleteConnectionProfile('p-1');

      expect(mock.calls[0]).toEqual({
        method: 'deleteConnectionProfile',
        params: { id: 'p-1' },
      });
      expect(result).toEqual({ deleted: true });
    });

    it('getProfilePassword: profileId を {id} として渡し password を返す', async () => {
      mock.setResponse('getProfilePassword', { password: 'secret' });

      const result = await settingsProvider.getProfilePassword('p-1');

      expect(mock.calls[0]).toEqual({ method: 'getProfilePassword', params: { id: 'p-1' } });
      expect(result).toEqual({ password: 'secret' });
    });

    it('getSshPassword: profileId を {id} として渡し password を返す', async () => {
      mock.setResponse('getSshPassword', { password: 'ssh-secret' });

      const result = await settingsProvider.getSshPassword('p-1');

      expect(mock.calls[0]).toEqual({ method: 'getSshPassword', params: { id: 'p-1' } });
      expect(result).toEqual({ password: 'ssh-secret' });
    });

    it('getSshKeyPassphrase: profileId を {id} として渡し passphrase を返す', async () => {
      mock.setResponse('getSshKeyPassphrase', { passphrase: 'pass' });

      const result = await settingsProvider.getSshKeyPassphrase('p-1');

      expect(mock.calls[0]).toEqual({ method: 'getSshKeyPassphrase', params: { id: 'p-1' } });
      expect(result).toEqual({ passphrase: 'pass' });
    });
  });

  describe('セッション (getSessionState / saveSessionState)', () => {
    it('getSessionState: IPC を呼び戻り値を返す', async () => {
      mock.setResponse('getSessionState', SAMPLE_SESSION);

      const result = await settingsProvider.getSessionState();

      expect(mock.calls[0]).toEqual({ method: 'getSessionState', params: {} });
      expect(result).toEqual(SAMPLE_SESSION);
    });

    it('saveSessionState: IPC に引数を渡し saved を返す', async () => {
      mock.setResponse('saveSessionState', { saved: true });

      const result = await settingsProvider.saveSessionState(SAMPLE_SAVE_SESSION);

      expect(mock.calls[0]).toEqual({
        method: 'saveSessionState',
        params: SAMPLE_SAVE_SESSION,
      });
      expect(result).toEqual({ saved: true });
    });
  });

  describe('エラー伝播 (全メソッド)', () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['getSettings', () => settingsProvider.getSettings()],
      ['updateSettings', () => settingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS)],
      ['getConnectionProfiles', () => settingsProvider.getConnectionProfiles()],
      ['saveConnectionProfile', () => settingsProvider.saveConnectionProfile(SAMPLE_SAVE_PROFILE)],
      ['deleteConnectionProfile', () => settingsProvider.deleteConnectionProfile('p-1')],
      ['getProfilePassword', () => settingsProvider.getProfilePassword('p-1')],
      ['getSshPassword', () => settingsProvider.getSshPassword('p-1')],
      ['getSshKeyPassphrase', () => settingsProvider.getSshKeyPassphrase('p-1')],
      ['getSessionState', () => settingsProvider.getSessionState()],
      ['saveSessionState', () => settingsProvider.saveSessionState(SAMPLE_SAVE_SESSION)],
    ];

    it.each(cases)('%s: IPC エラーを呼出側に伝播する', async (method, call) => {
      mock.setError(method, `${method} failed`);

      await expect(call()).rejects.toThrow(`${method} failed`);
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('getSettings', SAMPLE_SETTINGS);
    const { getSettings } = settingsProvider;

    await getSettings();

    expect(mock.calls[0]?.method).toBe('getSettings');
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('getSettings', SAMPLE_SETTINGS);
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('getSettings', SAMPLE_SETTINGS);
    __setIpcInvokerForTest(second);

    await settingsProvider.getSettings();

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
