import { memo } from 'react';
import type { ResultSet } from '../../types';
import styles from './ResultGrid.module.css';

interface GridStatusBarProps {
  resultSet: ResultSet;
  filteredRowCount: number;
  isFiltered: boolean;
  isReadOnly: boolean;
  connectionLabel?: string;
}

function GridStatusBarInner({
  resultSet,
  filteredRowCount,
  isFiltered,
  isReadOnly,
  connectionLabel,
}: GridStatusBarProps) {
  return (
    <div className={styles.statusBar}>
      {connectionLabel && (
        <>
          <span>{connectionLabel}</span>
          <span className={styles.statusSeparator} />
        </>
      )}
      {resultSet.truncated ? (
        <span className={styles.truncationWarning}>
          {isFiltered
            ? `⚠ ${filteredRowCount} / ${resultSet.rows.length.toLocaleString()}+ 件 (フィルタ中・行数制限あり)`
            : `⚠ 先頭 ${resultSet.rows.length.toLocaleString()} 件を表示（テーブルにはさらにデータがあります）`}
        </span>
      ) : (
        <span>
          {isFiltered
            ? `${filteredRowCount} / ${resultSet.rows.length} 件 (フィルタ中)`
            : `${resultSet.rows.length} 件`}
        </span>
      )}
      <span className={styles.statusSeparator} />
      <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
      {resultSet.affectedRows > 0 && (
        <>
          <span className={styles.statusSeparator} />
          <span>{resultSet.affectedRows} 件更新</span>
        </>
      )}
      {isReadOnly && <span className={styles.readOnlyIndicator}>読取専用</span>}
    </div>
  );
}

export const GridStatusBar = memo(GridStatusBarInner);
