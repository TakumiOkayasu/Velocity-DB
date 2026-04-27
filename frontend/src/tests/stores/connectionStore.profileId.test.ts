import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../store/connectionStore';

const mockConnectAsync = vi.fn();
const mockGetConnectResult = vi.fn();
const mockCancelConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockTestConnection = vi.fn();

vi.mock('../../api/bridge', () => ({
  bridge: {
    connectAsync: (...args: unknown[]) => mockConnectAsync(...args),
    getConnectResult: (...args: unknown[]) => mockGetConnectResult(...args),
    cancelConnect: (...args: unknown[]) => mockCancelConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    testConnection: (...args: unknown[]) => mockTestConnection(...args),
  },
}));

const baseConnection = {
  name: 'Test',
  server: 'localhost',
  port: 1433,
  database: 'testdb',
  username: 'sa',
  password: 'pass',
  useWindowsAuth: false,
  dbType: 'sqlserver' as const,
  isProduction: false,
  isReadOnly: false,
};

describe('connectionStore profileId-based identification (#414)', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      isConnecting: false,
      connectRequestId: null,
      connectCancelled: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      isConnecting: false,
      connectRequestId: null,
      connectCancelled: false,
      error: null,
    });
  });

  it('別 profileId かつ同名なら共存する (Develop/Test と Staging/Test)', async () => {
    mockConnectAsync.mockResolvedValue({ requestId: 'req_2' });
    mockGetConnectResult.mockResolvedValue({ status: 'connected', connectionId: 'db_staging' });
    mockDisconnect.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [
        {
          ...baseConnection,
          id: 'db_dev',
          isActive: true,
          profileId: 'profile_develop_test',
          server: 'docker-host',
        },
      ],
    });

    await useConnectionStore.getState().addConnection({
      ...baseConnection,
      profileId: 'profile_staging_test',
      server: '123.231.222.1',
    });

    const state = useConnectionStore.getState();
    expect(state.connections).toHaveLength(2);
    expect(mockDisconnect).not.toHaveBeenCalled();

    // #414 真の症状の契約化: 既存 profile 由来接続の DB 接続情報が改変されないこと。
    // count・disconnect 呼び出し数だけだと「片方が他方の server を上書き」を検出できない。
    const dev = state.connections.find((c) => c.profileId === 'profile_develop_test');
    const stg = state.connections.find((c) => c.profileId === 'profile_staging_test');
    expect(dev?.server).toBe('docker-host');
    expect(stg?.server).toBe('123.231.222.1');
    expect(dev?.id).toBe('db_dev');
    expect(stg?.id).toBe('db_staging');
  });

  it('同じ profileId で再接続すると既存を置換する', async () => {
    mockConnectAsync.mockResolvedValue({ requestId: 'req_3' });
    mockGetConnectResult.mockResolvedValue({ status: 'connected', connectionId: 'db_new' });
    mockDisconnect.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [
        {
          ...baseConnection,
          id: 'db_old',
          isActive: true,
          profileId: 'profile_dev',
        },
      ],
    });

    const result = await useConnectionStore.getState().addConnection({
      ...baseConnection,
      profileId: 'profile_dev',
    });

    const state = useConnectionStore.getState();
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].id).toBe('db_new');
    expect(mockDisconnect).toHaveBeenCalledWith('db_old');
    expect(result.replaced).toEqual({ oldId: 'db_old', newId: 'db_new' });
  });

  it('profileId 無し (手動接続) は同名で従来どおり置換する (後方互換)', async () => {
    mockConnectAsync.mockResolvedValue({ requestId: 'req_4' });
    mockGetConnectResult.mockResolvedValue({ status: 'connected', connectionId: 'db_manual_2' });
    mockDisconnect.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [{ ...baseConnection, id: 'db_manual_1', isActive: true }],
    });

    await useConnectionStore.getState().addConnection(baseConnection);

    const state = useConnectionStore.getState();
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].id).toBe('db_manual_2');
    expect(mockDisconnect).toHaveBeenCalledWith('db_manual_1');
  });

  it('profileId あり追加時に profileId 無し同名は影響を受けない', async () => {
    mockConnectAsync.mockResolvedValue({ requestId: 'req_5' });
    mockGetConnectResult.mockResolvedValue({
      status: 'connected',
      connectionId: 'db_from_profile',
    });
    mockDisconnect.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [{ ...baseConnection, id: 'db_manual', isActive: true }],
    });

    await useConnectionStore.getState().addConnection({
      ...baseConnection,
      profileId: 'profile_x',
    });

    const state = useConnectionStore.getState();
    expect(state.connections).toHaveLength(2);
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
