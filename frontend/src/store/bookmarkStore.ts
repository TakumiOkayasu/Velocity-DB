import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ioProvider } from '../api/providers';
import type { Bookmark } from '../types';
import { log } from '../utils/logger';

interface BookmarkState {
  bookmarks: Bookmark[];
  isLoading: boolean;
  error: string | null;

  loadBookmarks: () => Promise<void>;
  addBookmark: (name: string, content: string) => Promise<void>;
  deleteBookmark: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: [],
  isLoading: false,
  error: null,

  loadBookmarks: async () => {
    set({ isLoading: true, error: null });
    try {
      const bookmarks = await ioProvider.getBookmarks();
      log.info(`[BookmarkStore] Loaded ${bookmarks.length} bookmarks`);
      set({ bookmarks, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load bookmarks';
      log.error(`[BookmarkStore] ${message}`);
      set({ error: message, isLoading: false });
    }
  },

  addBookmark: async (name, content) => {
    const id = `bookmark-${crypto.randomUUID()}`;
    const newBookmark: Bookmark = { id, name, content };

    // Optimistic update
    set((state) => ({ bookmarks: [...state.bookmarks, newBookmark], error: null }));

    try {
      await ioProvider.saveBookmark(id, name, content);
      log.info(`[BookmarkStore] Saved bookmark: ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save bookmark';
      log.error(`[BookmarkStore] ${message}`);
      set({ error: message });
      // Resync with server to recover consistent state
      await get()
        .loadBookmarks()
        .catch(() => {});
    }
  },

  deleteBookmark: async (id) => {
    // Optimistic update
    set((state) => ({ bookmarks: state.bookmarks.filter((b) => b.id !== id), error: null }));

    try {
      await ioProvider.deleteBookmark(id);
      log.info(`[BookmarkStore] Deleted bookmark: ${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete bookmark';
      log.error(`[BookmarkStore] ${message}`);
      set({ error: message });
      // Resync with server to recover consistent state
      await get()
        .loadBookmarks()
        .catch(() => {});
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));

export const useBookmarks = () => useBookmarkStore(useShallow((state) => state.bookmarks));

export const useBookmarkActions = () =>
  useBookmarkStore(
    useShallow((state) => ({
      loadBookmarks: state.loadBookmarks,
      addBookmark: state.addBookmark,
      deleteBookmark: state.deleteBookmark,
      clearError: state.clearError,
    }))
  );
