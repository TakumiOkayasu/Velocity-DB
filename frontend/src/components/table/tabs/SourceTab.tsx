import { useCallback } from 'react';
import styles from '../TableViewer.module.css';

interface SourceTabProps {
  ddl: string;
}

export function SourceTab({ ddl }: SourceTabProps) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(ddl);
  }, [ddl]);

  if (!ddl) {
    return <div className={styles.emptyState}>No DDL available</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className={styles.filterBar}>
        <button type="button" className={styles.filterButton} onClick={handleCopy}>
          Copy DDL
        </button>
      </div>
      <div className={styles.codeContainer} style={{ flex: 1 }}>
        <pre className={styles.code}>{ddl}</pre>
      </div>
    </div>
  );
}
