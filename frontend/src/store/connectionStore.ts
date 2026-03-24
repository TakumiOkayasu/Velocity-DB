import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { bridge } from '../api/bridge';
import type { Connection } from '../types';

const POLL_INTERVAL_MS = 500;

interface ConnectionState {
  connections: Connection[];
  activeConnectionId: string | null;
  isConnecting: boolean;
  connectRequestId: string | null;
  connectCancelled: boolean;
  error: string | null;

  addConnection: (connection: Omit<Connection, 'id' | 'isActive'>) => Promise<void>;
  cancelConnection: () => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  toggleActive: (id: string) => void;
  testConnection: (connection: Omit<Connection, 'id' | 'isActive'>) => Promise<boolean>;
  clearError: () => void;
  setTableListLoadTime: (connectionId: string, loadTimeMs: number) => void;
  setTableOpenTime: (connectionId: string, loadTimeMs: number) => void;
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
      const { requestId } = await bridge.connectAsync({
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
        await bridge.cancelConnect(requestId).catch(() => {});
        set({ isConnecting: false, connectRequestId: null, connectCancelled: false });
        return;
      }

      set({ connectRequestId: requestId });

      const result = await new Promise<{ connectionId: string }>((resolve, reject) => {
        let active = true;
        const poll = async () => {
          while (active) {
            try {
              if (get().connectRequestId !== requestId) {
                active = false;
                reject(new Error('Connection cancelled'));
                return;
              }

              const status = await bridge.getConnectResult(requestId);

              if (status.status === 'connected' && status.connectionId) {
                active = false;
                resolve({ connectionId: status.connectionId });
                return;
              } else if (status.status === 'failed') {
                active = false;
                reject(new Error(status.error ?? 'Connection failed'));
                return;
              } else if (status.status === 'cancelled') {
                active = false;
                reject(new Error('Connection cancelled'));
                return;
              }
            } catch (e) {
              active = false;
              reject(e);
              return;
            }
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }
        };
        poll();
      });

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

      const existing = get().connections.find((c) => c.name === connection.name);
      if (existing) {
        await bridge.disconnect(existing.id).catch(() => {});
      }

      set((state) => ({
        connections: [
          ...state.connections.filter((c) => c.name !== connection.name),
          newConnection,
        ],
        activeConnectionId: result.connectionId,
        isConnecting: false,
        connectRequestId: null,
        connectCancelled: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      // If already cancelled by cancelConnection(), don't overwrite state
      if (message === 'Connection cancelled' || get().connectCancelled || !get().isConnecting) {
        return;
      }
      set({
        isConnecting: false,
        connectRequestId: null,
        connectCancelled: false,
        error: message,
      });
    }
  },

  cancelConnection: async () => {
    const { connectRequestId } = get();
    if (connectRequestId) {
      set({ connectRequestId: null, connectCancelled: false });
      await bridge.cancelConnect(connectRequestId).catch(() => {});
    } else {
      // Pre-IPC cancel: flag for addConnection to detect
      set({ connectCancelled: true });
    }
    set({ isConnecting: false, error: null });
  },

  removeConnection: async (id) => {
    const { activeConnectionId } = get();

    try {
      await bridge.disconnect(id);
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
      const result = await bridge.testConnection({
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
