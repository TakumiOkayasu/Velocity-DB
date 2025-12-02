import { create } from 'zustand'
import type { HistoryItem } from '../types'

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
}

let historyCounter = 0

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  searchKeyword: '',

  addHistory: (item) => {
    const id = `history-${++historyCounter}`
    const newItem: HistoryItem = {
      ...item,
      id,
    }

    set((state) => ({
      history: [newItem, ...state.history].slice(0, 10000), // Keep max 10000 items
    }))
  },

  removeHistory: (id) => {
    set((state) => ({
      history: state.history.filter((h) => h.id !== id),
    }))
  },

  clearHistory: () => {
    // Keep favorites
    set((state) => ({
      history: state.history.filter((h) => h.isFavorite),
    }))
  },

  setFavorite: (id, isFavorite) => {
    set((state) => ({
      history: state.history.map((h) =>
        h.id === id ? { ...h, isFavorite } : h
      ),
    }))
  },

  setSearchKeyword: (keyword) => {
    set({ searchKeyword: keyword })
  },

  getFilteredHistory: () => {
    const { history, searchKeyword } = get()
    if (!searchKeyword.trim()) {
      return history
    }

    const lowerKeyword = searchKeyword.toLowerCase()
    return history.filter((h) =>
      h.sql.toLowerCase().includes(lowerKeyword)
    )
  },

  getFavorites: () => {
    const { history } = get()
    return history.filter((h) => h.isFavorite)
  },
}))
