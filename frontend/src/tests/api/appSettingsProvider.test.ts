import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, appSettingsProvider } from '../../api/providers';
import type { AppSettings, UpdateSettingsInput } from '../../api/providers/app-settings';

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

const SAMPLE_UPDATE_SETTINGS: UpdateSettingsInput = {
  general: { autoConnect: false },
};

describe('appSettingsProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  it('getSettings: IPC を呼び戻り値を返す', async () => {
    mock.setResponse('getSettings', SAMPLE_SETTINGS);

    const result = await appSettingsProvider.getSettings();

    expect(mock.calls[0]).toEqual({ method: 'getSettings', params: {} });
    expect(result).toEqual(SAMPLE_SETTINGS);
  });

  it('getSettings: schema 不一致時に throw する', async () => {
    mock.setResponse('getSettings', { general: 'not an object' });

    await expect(appSettingsProvider.getSettings()).rejects.toThrow();
  });

  it('updateSettings: IPC に引数を渡し saved を返す', async () => {
    mock.setResponse('updateSettings', { saved: true });

    const result = await appSettingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS);

    expect(mock.calls[0]).toEqual({
      method: 'updateSettings',
      params: SAMPLE_UPDATE_SETTINGS,
    });
    expect(result).toEqual({ saved: true });
  });

  it('updateSettings: schema 不一致時に throw する', async () => {
    mock.setResponse('updateSettings', { saved: 'true' });

    await expect(appSettingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS)).rejects.toThrow();
  });

  describe('エラー伝播', () => {
    it('getSettings: IPC エラーを呼出側に伝播する', async () => {
      mock.setError('getSettings', 'getSettings failed');
      await expect(appSettingsProvider.getSettings()).rejects.toThrow('getSettings failed');
    });

    it('updateSettings: IPC エラーを呼出側に伝播する', async () => {
      mock.setError('updateSettings', 'updateSettings failed');
      await expect(appSettingsProvider.updateSettings(SAMPLE_UPDATE_SETTINGS)).rejects.toThrow(
        'updateSettings failed'
      );
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('getSettings', SAMPLE_SETTINGS);
    const { getSettings } = appSettingsProvider;

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

    await appSettingsProvider.getSettings();

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
