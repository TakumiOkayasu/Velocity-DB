import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, sessionProvider } from '../../api/providers';
import type { SaveSessionStateInput, SessionState } from '../../api/providers/session';

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

describe('sessionProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  it('getSessionState: IPC を呼び戻り値を返す', async () => {
    mock.setResponse('getSessionState', SAMPLE_SESSION);

    const result = await sessionProvider.getSessionState();

    expect(mock.calls[0]).toEqual({ method: 'getSessionState', params: {} });
    expect(result).toEqual(SAMPLE_SESSION);
  });

  it('getSessionState: schema 不一致時に throw する', async () => {
    mock.setResponse('getSessionState', { activeConnectionId: 123 });

    await expect(sessionProvider.getSessionState()).rejects.toThrow();
  });

  it('saveSessionState: IPC に引数を渡し saved を返す', async () => {
    mock.setResponse('saveSessionState', { saved: true });

    const result = await sessionProvider.saveSessionState(SAMPLE_SAVE_SESSION);

    expect(mock.calls[0]).toEqual({
      method: 'saveSessionState',
      params: SAMPLE_SAVE_SESSION,
    });
    expect(result).toEqual({ saved: true });
  });

  describe('エラー伝播', () => {
    it('getSessionState: IPC エラーを呼出側に伝播する', async () => {
      mock.setError('getSessionState', 'getSessionState failed');
      await expect(sessionProvider.getSessionState()).rejects.toThrow('getSessionState failed');
    });

    it('saveSessionState: IPC エラーを呼出側に伝播する', async () => {
      mock.setError('saveSessionState', 'saveSessionState failed');
      await expect(sessionProvider.saveSessionState(SAMPLE_SAVE_SESSION)).rejects.toThrow(
        'saveSessionState failed'
      );
    });
  });
});
