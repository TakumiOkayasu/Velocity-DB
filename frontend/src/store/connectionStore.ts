import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { connectionProvider, schemaProvider } from '../api/providers';
import type { Connection } from '../types';
import { pollConnection } from './connection/helpers/connectionPolling';

interface ConnectionState {
  connections: Connection[];
  activeConnectionId: string | null;
  isConnecting: boolean;
  connectRequestId: string | null;
  connectCancelled: boolean;
  error: string | null;

  addConnection: (
    connection: Omit<Connection, 'id' | 'isActive'>
  ) => Promise<{ replaced?: { oldId: string; newId: string } }>;
  cancelConnection: () => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  toggleActive: (id: string) => void;
  testConnection: (connection: Omit<Connection, 'id' | 'isActive'>) => Promise<boolean>;
  clearError: () => void;
  setTableListLoadTime: (connectionId: string, loadTimeMs: number) => void;
  setTableOpenTime: (connectionId: string, loadTimeMs: number) => void;
  profileVersion: number;
  incrementProfileVersion: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isConnecting: false,
  connectRequestId: null,
  connectCancelled: false,
  error: null,

  addConnection: async (connection) => {
    set({ isConnecting: true, error: null, connectRequestId: null, connectCancelled: false });

    try {
      const { requestId } = await connectionProvider.connectAsync({
        server: connection.server,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        useWindowsAuth: connection.useWindowsAuth,
        dbType: connection.dbType,
        ssh: connection.ssh?.enabled
          ? {
              enabled: true,
              host: connection.ssh.host,
              port: connection.ssh.port,
              username: connection.ssh.username,
              authType: connection.ssh.authType,
              password: connection.ssh.password,
              privateKeyPath: connection.ssh.privateKeyPath,
              keyPassphrase: connection.ssh.keyPassphrase,
            }
          : undefined,
      });

      // Check if cancelled while waiting for connectAsync IPC response
      if (get().connectCancelled) {
        await connectionProvider.cancelConnect(requestId).catch(() => {});
        set({ isConnecting: false, connectRequestId: null, connectCancelled: false });
        return {};
      }

      set({ connectRequestId: requestId });

      const result = await pollConnection(
        connectionProvider,
        requestId,
        () => get().connectRequestId !== requestId
      );

      const newConnection: Connection = {
        ...connection,
        id: result.connectionId,
        isActive: true,
        isProduction: connection.isProduction ?? false,
        isReadOnly: connection.isReadOnly ?? false,
        environment:
          connection.environment ?? (connection.isProduction ? 'production' : 'development'),
        dbType: connection.dbType ?? 'sqlserver',
      };

      // Profile 由来接続は profileId で同定 (#414): 同名でもフォルダ違いなら共存。
      // 手動接続 (profileId なし) は従来どおり同名で置換し、profile 由来とは衝突させない。
      const matchesExisting = (c: Connection) =>
        connection.profileId
          ? c.profileId === connection.profileId
          : c.name === connection.name && !c.profileId;

      const existing = get().connections.find(matchesExisting);
      const oldId = existing?.id;
      if (existing) {
        await connectionProvider.disconnect(existing.id).catch(() => {});
      }

      set((state) => ({
        connections: [...state.connections.filter((c) => !matchesExisting(c)), newConnection],
        activeConnectionId: result.connectionId,
        isConnecting: false,
        connectRequestId: null,
        connectCancelled: false,
      }));

      // 接続直後に getTables を fire-and-forget で先読みし SchemaProvider キャッシュに乗せる。
      // ツリー初回描画 (loadTables) がキャッシュ命中で即返り、接続→一覧表示の初回 (実測 ~165ms)
      // を体感ゼロにする (#512)。Promise.resolve().then で包むことで getTables の同期 throw も
      // reject に変換し .catch で握る (空 catch を避ける)。主フロー (replaced の返却) には影響しない。
      // loadTables と二重発行になっても劣化しない — putCache 前なら通常取得に戻り、後なら命中するだけ。
      void Promise.resolve()
        .then(() => schemaProvider.getTables(result.connectionId, ''))
        .catch(() => {});

      return oldId ? { replaced: { oldId, newId: result.connectionId } } : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      // If already cancelled by cancelConnection(), don't overwrite state
      if (message === 'Connection cancelled' || get().connectCancelled || !get().isConnecting) {
        return {};
      }
      set({
        isConnecting: false,
        connectRequestId: null,
        connectCancelled: false,
        error: message,
      });
      return {};
    }
  },

  cancelConnection: async () => {
    const { connectRequestId } = get();
    if (connectRequestId) {
      set({ connectRequestId: null, connectCancelled: false });
      await connectionProvider.cancelConnect(connectRequestId).catch(() => {});
    } else {
      // Pre-IPC cancel: flag for addConnection to detect
      set({ connectCancelled: true });
    }
    set({ isConnecting: false, error: null });
  },

  removeConnection: async (id) => {
    const { activeConnectionId } = get();

    try {
      await connectionProvider.disconnect(id);
    } catch {
      // Ignore disconnect errors
    }

    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      activeConnectionId: activeConnectionId === id ? null : activeConnectionId,
    }));
  },

  setActive: (id) => {
    set({ activeConnectionId: id });
  },

  toggleActive: (id) => {
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === id ? { ...c, isActive: !c.isActive } : c
      ),
    }));
  },

  testConnection: async (connection) => {
    set({ isConnecting: true, error: null });

    try {
      const result = await connectionProvider.testConnection({
        server: connection.server,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        useWindowsAuth: connection.useWindowsAuth,
        dbType: connection.dbType,
        ssh: connection.ssh?.enabled
          ? {
              enabled: true,
              host: connection.ssh.host,
              port: connection.ssh.port,
              username: connection.ssh.username,
              authType: connection.ssh.authType,
              password: connection.ssh.password,
              privateKeyPath: connection.ssh.privateKeyPath,
              keyPassphrase: connection.ssh.keyPassphrase,
            }
          : undefined,
      });

      set({ isConnecting: false });
      return result.success;
    } catch (error) {
      set({
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
      return false;
    }
  },

  clearError: () => {
    set({ error: null });
  },

  setTableListLoadTime: (connectionId, loadTimeMs) => {
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === connectionId ? { ...c, tableListLoadTimeMs: loadTimeMs } : c
      ),
    }));
  },

  setTableOpenTime: (connectionId, loadTimeMs) => {
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === connectionId ? { ...c, tableOpenTimeMs: loadTimeMs } : c
      ),
    }));
  },

  profileVersion: 0,
  incrementProfileVersion: () => {
    set((state) => ({ profileVersion: state.profileVersion + 1 }));
  },
}));

// Optimized selectors to prevent unnecessary re-renders
export const useConnections = () => useConnectionStore(useShallow((state) => state.connections));

export const useActiveConnection = () =>
  useConnectionStore((state) => {
    const connection = state.connections.find((c) => c.id === state.activeConnectionId);
    return connection ?? null;
  });

export const useIsProductionMode = () =>
  useConnectionStore((state) => {
    const connection = state.connections.find((c) => c.id === state.activeConnectionId);
    return connection?.isProduction ?? false;
  });

export const useIsReadOnlyMode = () =>
  useConnectionStore((state) => {
    const connection = state.connections.find((c) => c.id === state.activeConnectionId);
    return connection?.isReadOnly ?? false;
  });

export const useConnectionActions = () =>
  useConnectionStore(
    useShallow((state) => ({
      addConnection: state.addConnection,
      cancelConnection: state.cancelConnection,
      removeConnection: state.removeConnection,
      setActive: state.setActive,
      toggleActive: state.toggleActive,
      testConnection: state.testConnection,
      clearError: state.clearError,
      setTableListLoadTime: state.setTableListLoadTime,
      setTableOpenTime: state.setTableOpenTime,
    }))
  );
