import { memo } from 'react';
import type { ResultSet } from '../../types';
import styles from './ResultGrid.module.css';

interface GridStatusBarProps {
  resultSet: ResultSet;
  filteredRowCount: number;
  isFiltered: boolean;
  isEditMode: boolean;
  isReadOnly: boolean;
  connectionLabel?: string;
}

function GridStatusBarInner({
  resultSet,
  filteredRowCount,
  isFiltered,
  isEditMode,
  isReadOnly,
  connectionLabel,
}: GridStatusBarProps) {
  return (
    <div className={styles.statusBar}>
      {connectionLabel && (
        <>
          <span>{connectionLabel}</span>
          <span>|</span>
        </>
      )}
      <span>
        {isFiltered
          ? resultSet.truncated
            ? `${filteredRowCount} / ${resultSet.rows.length.toLocaleString()}+ 件 (フィルタ中・行数制限あり)`
            : `${filteredRowCount} / ${resultSet.rows.length} 件 (フィルタ中)`
          : resultSet.truncated
            ? `先頭 ${resultSet.rows.length.toLocaleString()} 件を表示（テーブルにはさらにデータがあります）`
            : `${resultSet.rows.length} 件`}
      </span>
      <span>|</span>
      <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
      {resultSet.affectedRows > 0 && (
        <>
          <span>|</span>
          <span>{resultSet.affectedRows} 件更新</span>
        </>
      )}
      {isReadOnly && <span className={styles.readOnlyIndicator}>読取専用</span>}
      {isEditMode && <span className={styles.editModeIndicator}>編集モード</span>}
    </div>
  );
}

export const GridStatusBar = memo(GridStatusBarInner);
