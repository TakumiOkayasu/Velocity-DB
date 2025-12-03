import { useHistoryStore } from '../../store/historyStore';
import { HistoryItem } from './HistoryItem';
import styles from './QueryHistory.module.css';

export function QueryHistory() {
  const { searchKeyword, setSearchKeyword, getFilteredHistory, clearHistory } = useHistoryStore();
  const history = getFilteredHistory();

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Search history..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          className={styles.searchInput}
        />
        <button
          onClick={clearHistory}
          className={styles.clearButton}
          title="Clear history (keeps favorites)"
        >
          Clear
        </button>
      </div>

      <div className={styles.list}>
        {history.length === 0 ? (
          <div className={styles.empty}>
            {searchKeyword ? 'No matching queries' : 'No query history'}
          </div>
        ) : (
          history.map((item) => <HistoryItem key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
