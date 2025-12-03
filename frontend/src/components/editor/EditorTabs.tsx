import { useQueryStore } from '../../store/queryStore'
import styles from './EditorTabs.module.css'

export function EditorTabs() {
  const { queries, activeQueryId, addQuery, removeQuery, setActive } = useQueryStore()

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {queries.map((query) => (
          <div
            key={query.id}
            className={`${styles.tab} ${query.id === activeQueryId ? styles.active : ''}`}
            onClick={() => setActive(query.id)}
          >
            <span className={styles.tabName}>
              {query.isDirty && <span className={styles.dirty}>笳・/span>}
              {query.name}
            </span>
            <button
              className={styles.closeButton}
              onClick={(e) => {
                e.stopPropagation()
                removeQuery(query.id)
              }}
              title="Close tab"
            >
              ﾃ・            </button>
          </div>
        ))}
      </div>
      <button
        className={styles.addButton}
        onClick={() => addQuery()}
        title="New Query (Ctrl+N)"
      >
        +
      </button>
    </div>
  )
}
