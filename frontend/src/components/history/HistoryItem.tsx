import { memo, useCallback } from 'react';
import { useHistoryStore } from '../../store/historyStore';
import { useQueryStore } from '../../store/queryStore';
import type { HistoryItem as HistoryItemType } from '../../types';
import styles from './HistoryItem.module.css';

interface HistoryItemProps {
  item: HistoryItemType;
}

export const HistoryItem = memo(function HistoryItem({ item }: HistoryItemProps) {
  const { setFavorite, removeHistory } = useHistoryStore();
  const { addQuery, queries, updateQuery, executeQuery } = useQueryStore();

  const formatTimestamp = (date: Date): string => {
    return date.toLocaleString('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateSql = (sql: string, maxLength = 100): string => {
    const singleLine = sql.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLength) return singleLine;
    return `${singleLine.substring(0, maxLength)}...`;
  };

  const handleClick = useCallback(() => {
    // Add query to new tab or update active tab
    if (queries.length === 0) {
      addQuery();
    }
    const activeId = useQueryStore.getState().activeQueryId;
    if (activeId) {
      updateQuery(activeId, item.sql);
    }
  }, [queries.length, addQuery, updateQuery, item.sql]);

  const handleDoubleClick = useCallback(() => {
    // Set SQL in editor and execute it
    handleClick();

    // Execute the query
    const activeId = useQueryStore.getState().activeQueryId;
    if (activeId && item.connectionId) {
      executeQuery(activeId, item.connectionId);
    }
  }, [handleClick, executeQuery, item.connectionId]);

  return (
    <div
      className={`${styles.container} ${item.success ? '' : styles.error}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className={styles.header}>
        <span className={styles.status}>{item.success ? '✓' : '✗'}</span>
        <span className={styles.timestamp}>{formatTimestamp(item.timestamp)}</span>
        <span className={styles.duration}>{item.executionTimeMs.toFixed(0)}ms</span>
        <button
          className={`${styles.favoriteButton} ${item.isFavorite ? styles.active : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setFavorite(item.id, !item.isFavorite);
          }}
          title={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {item.isFavorite ? '★' : '☆'}
        </button>
        <button
          className={styles.deleteButton}
          onClick={(e) => {
            e.stopPropagation();
            removeHistory(item.id);
          }}
          title="Remove from history"
        >
          ×
        </button>
      </div>
      <div className={styles.sql}>{truncateSql(item.sql)}</div>
      {!item.success && item.errorMessage && (
        <div className={styles.errorMessage}>{item.errorMessage}</div>
      )}
    </div>
  );
});
