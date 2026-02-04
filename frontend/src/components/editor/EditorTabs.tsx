import { useQueryStore } from '../../store/queryStore';
import styles from './EditorTabs.module.css';

// SQL file icon
const SqlIcon = (
  <svg
    className={styles.tabIcon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
  >
    <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
    <path d="M9 1v4h4" />
  </svg>
);

// Plus icon for add button
const PlusIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

// Close icon
const CloseIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export function EditorTabs() {
  const { queries, activeQueryId, addQuery, removeQuery, setActive } = useQueryStore();

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {queries.map((query) => (
          <div
            key={query.id}
            className={`${styles.tab} ${query.id === activeQueryId ? styles.active : ''}`}
            onClick={() => setActive(query.id)}
          >
            {SqlIcon}
            <span className={styles.tabName}>
              {query.isDirty && <span className={styles.dirty}>●</span>}
              {query.name}
            </span>
            <button
              className={styles.closeButton}
              onClick={(e) => {
                e.stopPropagation();
                removeQuery(query.id);
              }}
              title="タブを閉じる"
            >
              {CloseIcon}
            </button>
          </div>
        ))}
      </div>
      <button className={styles.addButton} onClick={() => addQuery()} title="新規クエリ (Ctrl+N)">
        {PlusIcon}
      </button>
    </div>
  );
}
