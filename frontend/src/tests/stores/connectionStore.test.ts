import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useConnectionStore } from '../../store/connectionStore';

const mockConnectAsync = vi.fn();
const mockGetConnectResult = vi.fn();
const mockCancelConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockTestConnection = vi.fn();
const mockGetTables = vi.fn();

vi.mock('../../api/providers', () => ({
  connectionProvider: {
    connectAsync: (...args: unknown[]) => mockConnectAsync(...args),
    getConnectResult: (...args: unknown[]) => mockGetConnectResult(...args),
    cancelConnect: (...args: unknown[]) => mockCancelConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    testConnection: (...args: unknown[]) => mockTestConnection(...args),
  },
  schemaProvider: {
    getTables: (...args: unknown[]) => mockGetTables(...args),
  },
}));

const baseConnection = {
  name: 'Test DB',
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

describe('connectionStore', () => {
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
    mockGetTables.mockResolvedValue({ tables: [], loadTimeMs: 0 });
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

  describe('addConnection', () => {
    it('should prefetch getTables into cache after successful connection (#512)', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_1' });
      mockGetConnectResult.mockResolvedValue({ status: 'connected', connectionId: 'db_1' });

      await useConnectionStore.getState().addConnection(baseConnection);

      // プリフェッチは Promise.resolve().then で次のマイクロタスクに遅延するため待機する
      await vi.waitFor(() => expect(mockGetTables).toHaveBeenCalledWith('db_1', ''));
    });

    it('should connect successfully via async polling', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_1',
      });

      await useConnectionStore.getState().addConnection(baseConnection);

      const state = useConnectionStore.getState();
      expect(state.isConnecting).toBe(false);
      expect(state.connections).toHaveLength(1);
      expect(state.connections[0].id).toBe('db_1');
      expect(state.activeConnectionId).toBe('db_1');
      expect(state.connectRequestId).toBeNull();
    });

    it('should preserve explicit environment (staging) instead of inferring from isProduction', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_1',
      });

      await useConnectionStore.getState().addConnection({
        ...baseConnection,
        environment: 'staging',
      });

      const state = useConnectionStore.getState();
      expect(state.connections[0].environment).toBe('staging');
    });

    it('should set isConnecting=true during connection', async () => {
      let resolveConnect: ((v: { requestId: string }) => void) | undefined;
      mockConnectAsync.mockReturnValue(
        new Promise((r) => {
          resolveConnect = r;
        })
      );

      const promise = useConnectionStore.getState().addConnection(baseConnection);

      expect(useConnectionStore.getState().isConnecting).toBe(true);

      resolveConnect?.({ requestId: 'conn_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_1',
      });

      await promise;
      expect(useConnectionStore.getState().isConnecting).toBe(false);
    });

    it('should handle connection failure from polling', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'failed',
        error: 'Connection refused',
      });

      await useConnectionStore
        .getState()
        .addConnection(baseConnection)
        .catch(() => {});

      const state = useConnectionStore.getState();
      expect(state.isConnecting).toBe(false);
      expect(state.error).toBe('Connection refused');
      expect(state.connections).toHaveLength(0);
    });

    it('should handle connectAsync IPC rejection', async () => {
      mockConnectAsync.mockRejectedValue(new Error('IPC timeout'));

      await useConnectionStore
        .getState()
        .addConnection(baseConnection)
        .catch(() => {});

      const state = useConnectionStore.getState();
      expect(state.isConnecting).toBe(false);
      expect(state.error).toBe('IPC timeout');
      expect(state.connections).toHaveLength(0);
    });

    it('should replace existing connection with same name', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_2' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_2',
      });
      mockDisconnect.mockResolvedValue(undefined);

      useConnectionStore.setState({
        connections: [{ ...baseConnection, id: 'db_1', isActive: true }],
      });

      await useConnectionStore.getState().addConnection(baseConnection);

      const state = useConnectionStore.getState();
      expect(state.connections).toHaveLength(1);
      expect(state.connections[0].id).toBe('db_2');
      expect(mockDisconnect).toHaveBeenCalledWith('db_1');
    });

    it('同名接続置換時に replaced を返す', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'req_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_new',
      });
      mockDisconnect.mockResolvedValue(undefined);

      useConnectionStore.setState({
        connections: [{ ...baseConnection, id: 'db_old', isActive: true }],
      });

      const result = await useConnectionStore.getState().addConnection(baseConnection);

      expect(result.replaced).toEqual({ oldId: 'db_old', newId: 'db_new' });
    });

    it('新規接続では replaced が undefined', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'req_1' });
      mockGetConnectResult.mockResolvedValue({
        status: 'connected',
        connectionId: 'db_1',
      });

      const result = await useConnectionStore.getState().addConnection(baseConnection);

      expect(result.replaced).toBeUndefined();
    });
  });

  describe('cancelConnection', () => {
    it('should cancel with requestId (post-IPC)', async () => {
      mockCancelConnect.mockResolvedValue(undefined);

      useConnectionStore.setState({
        isConnecting: true,
        connectRequestId: 'conn_1',
      });

      await useConnectionStore.getState().cancelConnection();

      const state = useConnectionStore.getState();
      expect(state.isConnecting).toBe(false);
      expect(state.connectRequestId).toBeNull();
      expect(mockCancelConnect).toHaveBeenCalledWith('conn_1');
    });

    it('should set connectCancelled flag (pre-IPC)', async () => {
      useConnectionStore.setState({
        isConnecting: true,
        connectRequestId: null,
      });

      await useConnectionStore.getState().cancelConnection();

      const state = useConnectionStore.getState();
      expect(state.isConnecting).toBe(false);
      expect(state.connectCancelled).toBe(true);
      expect(mockCancelConnect).not.toHaveBeenCalled();
    });

    it('should abort addConnection when connectCancelled=true before requestId', async () => {
      let resolveConnect: ((v: { requestId: string }) => void) | undefined;
      mockConnectAsync.mockReturnValue(
        new Promise((r) => {
          resolveConnect = r;
        })
      );
      mockCancelConnect.mockResolvedValue(undefined);

      const promise = useConnectionStore.getState().addConnection(baseConnection);

      // Cancel before IPC response
      await useConnectionStore.getState().cancelConnection();
      expect(useConnectionStore.getState().connectCancelled).toBe(true);

      // IPC responds
      resolveConnect?.({ requestId: 'conn_1' });
      await promise;

      expect(mockCancelConnect).toHaveBeenCalledWith('conn_1');
      expect(useConnectionStore.getState().connections).toHaveLength(0);
    });
  });

  describe('cancelConnection does not cause state overwrite', () => {
    it('should not overwrite state after cancel during polling', async () => {
      mockConnectAsync.mockResolvedValue({ requestId: 'conn_1' });

      let pollCount = 0;
      mockGetConnectResult.mockImplementation(async () => {
        pollCount++;
        if (pollCount === 1) {
          // First poll: still pending, then cancel
          setTimeout(() => {
            useConnectionStore.getState().cancelConnection();
          }, 0);
          return { status: 'pending' };
        }
        return { status: 'cancelled' };
      });
      mockCancelConnect.mockResolvedValue(undefined);

      await useConnectionStore.getState().addConnection(baseConnection);

      const state = useConnectionStore.getState();
      expect(state.error).toBeNull();
      expect(state.connections).toHaveLength(0);
    });
  });

  describe('removeConnection', () => {
    it('should remove connection and call disconnect', async () => {
      mockDisconnect.mockResolvedValue(undefined);
      useConnectionStore.setState({
        connections: [{ ...baseConnection, id: 'db_1', isActive: true }],
        activeConnectionId: 'db_1',
      });

      await useConnectionStore.getState().removeConnection('db_1');

      expect(mockDisconnect).toHaveBeenCalledWith('db_1');
      expect(useConnectionStore.getState().connections).toHaveLength(0);
      expect(useConnectionStore.getState().activeConnectionId).toBeNull();
    });

    it('should keep activeConnectionId if removing different connection', async () => {
      mockDisconnect.mockResolvedValue(undefined);
      useConnectionStore.setState({
        connections: [
          { ...baseConnection, id: 'db_1', isActive: true },
          { ...baseConnection, id: 'db_2', name: 'Other', isActive: true },
        ],
        activeConnectionId: 'db_1',
      });

      await useConnectionStore.getState().removeConnection('db_2');

      expect(useConnectionStore.getState().activeConnectionId).toBe('db_1');
      expect(useConnectionStore.getState().connections).toHaveLength(1);
    });
  });

  describe('testConnection', () => {
    it('should return true on success', async () => {
      mockTestConnection.mockResolvedValue({ success: true });

      const result = await useConnectionStore.getState().testConnection(baseConnection);

      expect(result).toBe(true);
      expect(useConnectionStore.getState().isConnecting).toBe(false);
    });

    it('should return false on success=false response', async () => {
      mockTestConnection.mockResolvedValue({ success: false });

      const result = await useConnectionStore.getState().testConnection(baseConnection);

      expect(result).toBe(false);
      expect(useConnectionStore.getState().isConnecting).toBe(false);
    });

    it('should return false and set error on rejection', async () => {
      mockTestConnection.mockRejectedValue(new Error('Timeout'));

      const result = await useConnectionStore.getState().testConnection(baseConnection);

      expect(result).toBe(false);
      expect(useConnectionStore.getState().error).toBe('Timeout');
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      useConnectionStore.setState({ error: 'some error' });
      useConnectionStore.getState().clearError();
      expect(useConnectionStore.getState().error).toBeNull();
    });
  });

  describe('profileVersion', () => {
    it('初期値は0', () => {
      const state = useConnectionStore.getState();
      expect(state.profileVersion).toBe(0);
    });

    it('incrementProfileVersionで値が1増加する', () => {
      useConnectionStore.getState().incrementProfileVersion();
      expect(useConnectionStore.getState().profileVersion).toBe(1);

      useConnectionStore.getState().incrementProfileVersion();
      expect(useConnectionStore.getState().profileVersion).toBe(2);
    });
  });
});
