import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { bridge } from '../api/bridge';
import type { Connection } from '../types';

interface ConnectionState {
  connections: Connection[];
  activeConnectionId: string | null;
  isConnecting: boolean;
  error: string | null;

  addConnection: (connection: Omit<Connection, 'id'>) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  testConnection: (connection: Omit<Connection, 'id'>) => Promise<boolean>;
  clearError: () => void;
  setTableListLoadTime: (connectionId: string, loadTimeMs: number) => void;
  setTableOpenTime: (connectionId: string, loadTimeMs: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isConnecting: false,
  error: null,

  addConnection: async (connection) => {
    set({ isConnecting: true, error: null });

    try {
      const result = await bridge.connect({
        server: connection.server,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        useWindowsAuth: connection.useWindowsAuth,
      });

      const newConnection: Connection = {
        ...connection,
        id: result.connectionId,
      };

      set((state) => ({
        connections: [...state.connections, newConnection],
        activeConnectionId: result.connectionId,
        isConnecting: false,
      }));
    } catch (error) {
      set({
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      });
      throw error;
    }
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

export const useConnectionActions = () =>
  useConnectionStore(
    useShallow((state) => ({
      addConnection: state.addConnection,
      removeConnection: state.removeConnection,
      setActive: state.setActive,
      testConnection: state.testConnection,
      clearError: state.clearError,
      setTableListLoadTime: state.setTableListLoadTime,
      setTableOpenTime: state.setTableOpenTime,
    }))
  );
