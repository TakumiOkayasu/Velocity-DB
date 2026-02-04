import { useCallback, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueryActions } from '../../store/queryStore';
import { ObjectTree } from '../tree/ObjectTree';
import styles from './LeftPanel.module.css';

interface LeftPanelProps {
  width: number;
}

// Database icon
const DatabaseIcon = (
  <svg
    className={styles.headerIcon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <ellipse cx="8" cy="4" rx="6" ry="2.5" />
    <path d="M2 4v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" />
    <path d="M2 8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" />
  </svg>
);

export function LeftPanel({ width }: LeftPanelProps) {
  const [searchFilter, setSearchFilter] = useState('');
  const { activeConnectionId } = useConnectionStore();
  const { openTableData } = useQueryActions();

  const handleTableOpen = useCallback(
    (tableName: string, _tableType: 'table' | 'view', connectionId?: string) => {
      // Use the provided connectionId (from the clicked table) or fall back to activeConnectionId
      const targetConnectionId = connectionId || activeConnectionId;
      if (targetConnectionId) {
        openTableData(targetConnectionId, tableName);
      }
    },
    [activeConnectionId, openTableData]
  );

  return (
    <div className={styles.container} style={{ width }}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          {DatabaseIcon}
          データベース
        </span>
      </div>

      <div className={styles.searchBox}>
        <input
          type="text"
          placeholder="検索..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
      </div>

      <div className={styles.treeContainer}>
        <ObjectTree filter={searchFilter} onTableOpen={handleTableOpen} />
      </div>
    </div>
  );
}
