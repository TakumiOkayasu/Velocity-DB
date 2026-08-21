import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useHistoryStore } from '../../store/historyStore';

// Mock providers (#520 で queryProvider に移管済み)
vi.mock('../../api/providers', () => ({
  queryProvider: {
    getQueryHistory: vi.fn().mockResolvedValue([]),
    removeQueryHistory: vi.fn().mockResolvedValue({ removed: true }),
    clearQueryHistory: vi.fn().mockResolvedValue({ cleared: true }),
    setQueryHistoryFavorite: vi.fn().mockResolvedValue({ updated: true }),
  },
}));

// Import after mock
const { queryProvider } = await import('../../api/providers');

describe('historyStore', () => {
  beforeEach(() => {
    useHistoryStore.setState({ history: [], searchKeyword: '' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    useHistoryStore.setState({ history: [], searchKeyword: '' });
  });

  describe('fetchHistory', () => {
    it('should fetch history from backend and update store', async () => {
      vi.mocked(queryProvider.getQueryHistory).mockResolvedValue([
        {
          id: 'hist_1',
          sql: 'SELECT * FROM users',
          connectionId: 'conn_1',
          timestamp: 1706270400000,
          executionTimeMs: 150,
          success: true,
          errorMessage: '',
          affectedRows: 10,
          isFavorite: false,
        },
      ]);

      await useHistoryStore.getState().fetchHistory();

      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT * FROM users');
      expect(history[0].connectionId).toBe('conn_1');
      expect(history[0].timestamp).toBe(1706270400000);
    });
  });

  describe('getStats', () => {
    it('should return correct stats for mixed success/failure', () => {
      useHistoryStore.setState({
        history: [
          {
            id: '1',
            sql: 'SELECT 1',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 10,
            affectedRows: 0,
            success: true,
            errorMessage: '',
            isFavorite: false,
          },
          {
            id: '2',
            sql: 'SELECT 2',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 10,
            affectedRows: 0,
            success: true,
            errorMessage: '',
            isFavorite: false,
          },
          {
            id: '3',
            sql: 'FAIL 1',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 0,
            affectedRows: 0,
            success: false,
            errorMessage: '',
            isFavorite: false,
          },
        ],
      });

      const stats = useHistoryStore.getState().getStats();
      expect(stats.total).toBe(3);
      expect(stats.success).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it('should return zeros for empty history', () => {
      const stats = useHistoryStore.getState().getStats();
      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('setFavorite', () => {
    it('should call backend and refetch', async () => {
      vi.mocked(queryProvider.getQueryHistory).mockResolvedValue([
        {
          id: 'hist_1',
          sql: 'SELECT 1',
          connectionId: 'conn_1',
          timestamp: 1706270400000,
          executionTimeMs: 10,
          success: true,
          errorMessage: '',
          affectedRows: 0,
          isFavorite: true,
        },
      ]);

      await useHistoryStore.getState().setFavorite('hist_1', true);

      expect(queryProvider.setQueryHistoryFavorite).toHaveBeenCalledWith('hist_1', true);
      expect(queryProvider.getQueryHistory).toHaveBeenCalled();
    });
  });

  describe('clearHistory', () => {
    it('should call backend and refetch', async () => {
      vi.mocked(queryProvider.getQueryHistory).mockResolvedValue([]);

      await useHistoryStore.getState().clearHistory();

      expect(queryProvider.clearQueryHistory).toHaveBeenCalled();
      expect(queryProvider.getQueryHistory).toHaveBeenCalled();
    });
  });

  describe('getFilteredHistory', () => {
    it('should filter by search keyword', () => {
      useHistoryStore.setState({
        history: [
          {
            id: '1',
            sql: 'SELECT * FROM users',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 10,
            affectedRows: 0,
            success: true,
            errorMessage: '',
            isFavorite: false,
          },
          {
            id: '2',
            sql: 'SELECT * FROM orders',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 10,
            affectedRows: 0,
            success: true,
            errorMessage: '',
            isFavorite: false,
          },
        ],
        searchKeyword: 'users',
      });

      const filtered = useHistoryStore.getState().getFilteredHistory();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].sql).toContain('users');
    });

    it('should be case insensitive', () => {
      useHistoryStore.setState({
        history: [
          {
            id: '1',
            sql: 'SELECT * FROM USERS',
            connectionId: 'c',
            timestamp: Date.now(),
            executionTimeMs: 10,
            affectedRows: 0,
            success: true,
            errorMessage: '',
            isFavorite: false,
          },
        ],
        searchKeyword: 'users',
      });

      const filtered = useHistoryStore.getState().getFilteredHistory();
      expect(filtered).toHaveLength(1);
    });
  });

  describe('removeHistory', () => {
    it('should call backend and refetch', async () => {
      vi.mocked(queryProvider.getQueryHistory).mockResolvedValue([]);

      await useHistoryStore.getState().removeHistory('hist_1');

      expect(queryProvider.removeQueryHistory).toHaveBeenCalledWith('hist_1');
      expect(queryProvider.getQueryHistory).toHaveBeenCalled();
    });
  });
});
