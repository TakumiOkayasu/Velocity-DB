import { memo } from 'react';
import type { ResultSet } from '../../types';
import type { GridViewMode } from '../../types/grid';
import styles from './ResultGrid.module.css';

interface GridStatusBarProps {
  resultSet: ResultSet;
  filteredRowCount: number;
  isFiltered: boolean;
  isReadOnly: boolean;
  connectionLabel?: string;
  viewMode?: GridViewMode;
  transposeRowIndex?: number;
}

function GridStatusBarInner({
  resultSet,
  filteredRowCount,
  isFiltered,
  isReadOnly,
  connectionLabel,
  viewMode,
  transposeRowIndex,
}: GridStatusBarProps) {
  const isTranspose = viewMode === 'transpose';
  const totalRows = resultSet.rows.length;

  return (
    <div className={styles.statusBar}>
      {connectionLabel && (
        <>
          <span>{connectionLabel}</span>
          <span className={styles.statusSeparator} />
        </>
      )}
      {isTranspose ? (
        <span>
          行 {totalRows > 0 ? (transposeRowIndex ?? 0) + 1 : 0} / {totalRows}
        </span>
      ) : resultSet.truncated ? (
        <span className={styles.truncationWarning}>
          {isFiltered
            ? `⚠ ${filteredRowCount} / ${totalRows.toLocaleString()}+ 件 (フィルタ中・行数制限あり)`
            : `⚠ 先頭 ${totalRows.toLocaleString()} 件を表示（テーブルにはさらにデータがあります）`}
        </span>
      ) : (
        <span>
          {isFiltered ? `${filteredRowCount} / ${totalRows} 件 (フィルタ中)` : `${totalRows} 件`}
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
