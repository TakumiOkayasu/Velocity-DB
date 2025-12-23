import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { HistoryItem } from '../types';

export interface HistoryStats {
  total: number;
  success: number;
  failed: number;
}

interface HistoryState {
  history: HistoryItem[];
  searchKeyword: string;

  addHistory: (item: Omit<HistoryItem, 'id'>) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  setFavorite: (id: string, isFavorite: boolean) => void;
  setSearchKeyword: (keyword: string) => void;
  getFilteredHistory: () => HistoryItem[];
  getFavorites: () => HistoryItem[];
  getStats: () => HistoryStats;
  exportHistory: () => string;
  importHistory: (json: string) => void;
}

let historyCounter = 0;

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      history: [],
      searchKeyword: '',

      addHistory: (item) => {
        const id = `history-${++historyCounter}`;
        const newItem: HistoryItem = {
          ...item,
          id,
        };

        set((state) => ({
          history: [newItem, ...state.history].slice(0, 10000), // Keep max 10000 items
        }));
      },

      removeHistory: (id) => {
        set((state) => ({
          history: state.history.filter((h) => h.id !== id),
        }));
      },

      clearHistory: () => {
        // Keep favorites
        set((state) => ({
          history: state.history.filter((h) => h.isFavorite),
        }));
      },

      setFavorite: (id, isFavorite) => {
        set((state) => ({
          history: state.history.map((h) => (h.id === id ? { ...h, isFavorite } : h)),
        }));
      },

      setSearchKeyword: (keyword) => {
        set({ searchKeyword: keyword });
      },

      getFilteredHistory: () => {
        const { history, searchKeyword } = get();
        if (!searchKeyword.trim()) {
          return history;
        }

        const lowerKeyword = searchKeyword.toLowerCase();
        return history.filter((h) => h.sql.toLowerCase().includes(lowerKeyword));
      },

      getFavorites: () => {
        const { history } = get();
        return history.filter((h) => h.isFavorite);
      },

      getStats: () => {
        const { history } = get();
        const total = history.length;
        const success = history.filter((h) => h.success).length;
        const failed = total - success;
        return { total, success, failed };
      },

      exportHistory: () => {
        const { history } = get();
        return JSON.stringify(history, null, 2);
      },

      importHistory: (json: string) => {
        try {
          const imported = JSON.parse(json) as HistoryItem[];
          if (!Array.isArray(imported)) {
            throw new Error('Invalid format');
          }
          // Merge with existing, avoiding duplicates by SQL content
          set((state) => {
            const existingSql = new Set(state.history.map((h) => h.sql));
            const newItems = imported.filter((h) => !existingSql.has(h.sql));
            return {
              history: [...state.history, ...newItems].slice(0, 10000),
            };
          });
        } catch (error) {
          console.error('Failed to import history:', error);
        }
      },
    }),
    {
      name: 'query-history',
      partialize: (state) => ({
        history: state.history,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state?.history) {
            // Update historyCounter to avoid ID collisions
            const maxId = state.history.reduce((max, h) => {
              const num = Number.parseInt(h.id.replace('history-', ''), 10);
              return Number.isNaN(num) ? max : Math.max(max, num);
            }, 0);
            historyCounter = maxId;
          }
        };
      },
    }
  )
);

// Optimized selectors to prevent unnecessary re-renders
export const useHistoryItems = () => useHistoryStore(useShallow((state) => state.history));

export const useHistorySearch = () => useHistoryStore((state) => state.searchKeyword);

export const useHistoryActions = () =>
  useHistoryStore(
    useShallow((state) => ({
      addHistory: state.addHistory,
      removeHistory: state.removeHistory,
      clearHistory: state.clearHistory,
      setFavorite: state.setFavorite,
      setSearchKeyword: state.setSearchKeyword,
      getFilteredHistory: state.getFilteredHistory,
      getFavorites: state.getFavorites,
      getStats: state.getStats,
      exportHistory: state.exportHistory,
      importHistory: state.importHistory,
    }))
  );
