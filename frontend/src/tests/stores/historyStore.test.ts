import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHistoryStore } from '../../store/historyStore';

describe('historyStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useHistoryStore.setState({ history: [], searchKeyword: '' });
  });

  afterEach(() => {
    // Clean up after each test
    useHistoryStore.setState({ history: [], searchKeyword: '' });
  });

  describe('addHistory', () => {
    it('should add a history item with generated id', () => {
      const { addHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT * FROM users',
        connectionId: 'conn_1',
        timestamp: new Date('2026-01-09T12:00:00'),
        executionTimeMs: 150,
        affectedRows: 10,
        success: true,
        isFavorite: false,
      });

      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0].sql).toBe('SELECT * FROM users');
      expect(history[0].id).toMatch(/^history-\d+$/);
      expect(history[0].success).toBe(true);
    });

    it('should prepend new items to history', () => {
      const { addHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT 1',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      addHistory({
        sql: 'SELECT 2',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 20,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      const { history } = useHistoryStore.getState();
      expect(history).toHaveLength(2);
      expect(history[0].sql).toBe('SELECT 2'); // Most recent first
      expect(history[1].sql).toBe('SELECT 1');
    });

    it('should record failed queries with error message', () => {
      const { addHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT * FROM nonexistent',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 0,
        affectedRows: 0,
        success: false,
        errorMessage: 'Table not found',
        isFavorite: false,
      });

      const { history } = useHistoryStore.getState();
      expect(history[0].success).toBe(false);
      expect(history[0].errorMessage).toBe('Table not found');
    });
  });

  describe('getStats', () => {
    it('should return correct stats for mixed success/failure', () => {
      const { addHistory, getStats } = useHistoryStore.getState();

      // Add 3 successful queries
      for (let i = 0; i < 3; i++) {
        addHistory({
          sql: `SELECT ${i}`,
          connectionId: 'conn_1',
          timestamp: new Date(),
          executionTimeMs: 10,
          affectedRows: 0,
          success: true,
          isFavorite: false,
        });
      }

      // Add 2 failed queries
      for (let i = 0; i < 2; i++) {
        addHistory({
          sql: `FAIL ${i}`,
          connectionId: 'conn_1',
          timestamp: new Date(),
          executionTimeMs: 0,
          affectedRows: 0,
          success: false,
          isFavorite: false,
        });
      }

      const stats = getStats();
      expect(stats.total).toBe(5);
      expect(stats.success).toBe(3);
      expect(stats.failed).toBe(2);
    });

    it('should return zeros for empty history', () => {
      const { getStats } = useHistoryStore.getState();
      const stats = getStats();

      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('setFavorite', () => {
    it('should toggle favorite status', () => {
      const { addHistory, setFavorite } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT * FROM users',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      const { history } = useHistoryStore.getState();
      const itemId = history[0].id;

      setFavorite(itemId, true);
      expect(useHistoryStore.getState().history[0].isFavorite).toBe(true);

      setFavorite(itemId, false);
      expect(useHistoryStore.getState().history[0].isFavorite).toBe(false);
    });
  });

  describe('clearHistory', () => {
    it('should keep favorites when clearing', () => {
      const { addHistory, setFavorite, clearHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT 1',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      addHistory({
        sql: 'SELECT 2 -- favorite',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      // Mark second item as favorite
      const { history } = useHistoryStore.getState();
      setFavorite(history[0].id, true);

      clearHistory();

      const newHistory = useHistoryStore.getState().history;
      expect(newHistory).toHaveLength(1);
      expect(newHistory[0].sql).toBe('SELECT 2 -- favorite');
    });
  });

  describe('getFilteredHistory', () => {
    it('should filter by search keyword', () => {
      const { addHistory, setSearchKeyword, getFilteredHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT * FROM users',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      addHistory({
        sql: 'SELECT * FROM orders',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      setSearchKeyword('users');
      const filtered = getFilteredHistory();

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sql).toContain('users');
    });

    it('should be case insensitive', () => {
      const { addHistory, setSearchKeyword, getFilteredHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT * FROM USERS',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      setSearchKeyword('users');
      const filtered = getFilteredHistory();

      expect(filtered).toHaveLength(1);
    });
  });

  describe('removeHistory', () => {
    it('should remove specific item by id', () => {
      const { addHistory, removeHistory } = useHistoryStore.getState();

      addHistory({
        sql: 'SELECT 1',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      addHistory({
        sql: 'SELECT 2',
        connectionId: 'conn_1',
        timestamp: new Date(),
        executionTimeMs: 10,
        affectedRows: 0,
        success: true,
        isFavorite: false,
      });

      const { history } = useHistoryStore.getState();
      const idToRemove = history[0].id;

      removeHistory(idToRemove);

      const newHistory = useHistoryStore.getState().history;
      expect(newHistory).toHaveLength(1);
      expect(newHistory[0].sql).toBe('SELECT 1');
    });
  });
});
