import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { queryProvider } from '../api/providers';
import type { HistoryItem } from '../types';

export interface HistoryStats {
  total: number;
  success: number;
  failed: number;
}

interface HistoryState {
  history: HistoryItem[];
  searchKeyword: string;

  fetchHistory: () => Promise<void>;
  removeHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  setFavorite: (id: string, isFavorite: boolean) => Promise<void>;
  setSearchKeyword: (keyword: string) => void;
  getFilteredHistory: () => HistoryItem[];
  getFavorites: () => HistoryItem[];
  getStats: () => HistoryStats;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  history: [],
  searchKeyword: '',

  fetchHistory: async () => {
    try {
      const items = await queryProvider.getQueryHistory();
      set({ history: items });
    } catch (error) {
      console.error('Failed to fetch query history:', error);
    }
  },

  removeHistory: async (id) => {
    try {
      await queryProvider.removeQueryHistory(id);
      await get().fetchHistory();
    } catch (error) {
      console.error('Failed to remove history:', error);
    }
  },

  clearHistory: async () => {
    try {
      await queryProvider.clearQueryHistory();
      await get().fetchHistory();
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  },

  setFavorite: async (id, isFavorite) => {
    try {
      await queryProvider.setQueryHistoryFavorite(id, isFavorite);
      await get().fetchHistory();
    } catch (error) {
      console.error('Failed to set favorite:', error);
    }
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
}));

// Optimized selectors to prevent unnecessary re-renders
export const useHistoryItems = () => useHistoryStore(useShallow((state) => state.history));

export const useHistorySearch = () => useHistoryStore((state) => state.searchKeyword);

export const useHistoryActions = () =>
  useHistoryStore(
    useShallow((state) => ({
      fetchHistory: state.fetchHistory,
      removeHistory: state.removeHistory,
      clearHistory: state.clearHistory,
      setFavorite: state.setFavorite,
      setSearchKeyword: state.setSearchKeyword,
      getFilteredHistory: state.getFilteredHistory,
      getFavorites: state.getFavorites,
      getStats: state.getStats,
    }))
  );
