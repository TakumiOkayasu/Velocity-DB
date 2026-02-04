import { useHistoryStore } from '../../store/historyStore';
import { HistoryItem } from './HistoryItem';
import styles from './QueryHistory.module.css';

export function QueryHistory() {
  const { searchKeyword, setSearchKeyword, getFilteredHistory, clearHistory, getStats } =
    useHistoryStore();
  const history = getFilteredHistory();
  const stats = getStats();

  return (
    <div className={styles.container}>
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>合計:</span>
          <span className={styles.statValue}>{stats.total}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>成功:</span>
          <span className={`${styles.statValue} ${styles.success}`}>{stats.success}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>失敗:</span>
          <span className={`${styles.statValue} ${styles.failed}`}>{stats.failed}</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="履歴を検索..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          className={styles.searchInput}
        />
        <button
          onClick={clearHistory}
          className={styles.clearButton}
          title="履歴をクリア（お気に入りは保持）"
        >
          クリア
        </button>
      </div>

      <div className={styles.list}>
        {history.length === 0 ? (
          <div className={styles.empty}>
            {searchKeyword ? '一致するクエリがありません' : 'クエリ履歴がありません'}
          </div>
        ) : (
          history.map((item) => <HistoryItem key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
