import { memo } from 'react';
import type { PaginationState } from '../../store/query/types';
import type { ResultSet } from '../../types';
import type { GridViewMode } from '../../types/grid';
import type { StatementType } from '../../utils/sqlIdentifier';
import styles from './ResultGrid.module.css';

interface GridStatusBarProps {
  resultSet: ResultSet;
  filteredRowCount: number;
  isFiltered: boolean;
  isReadOnly: boolean;
  connectionLabel?: string;
  viewMode?: GridViewMode;
  transposeRowIndex?: number;
  pagination?: PaginationState | null;
  /** 現在表示中の結果セットを生んだ SQL 種別。DML/DDL の表示文言切替に使う */
  statementType?: StatementType;
}

function affectedRowsLabel(
  statementType: StatementType | undefined,
  affectedRows: number
): string | null {
  switch (statementType) {
    case 'INSERT':
      return `${affectedRows} 件追加`;
    case 'UPDATE':
      return `${affectedRows} 件更新`;
    case 'DELETE':
      return `${affectedRows} 件削除`;
    case 'TRUNCATE':
      return 'テーブルを切り詰めました';
    case 'DROP':
    case 'CREATE':
    case 'ALTER':
      return `${statementType} を実行しました`;
    case 'SELECT':
      return null;
    case 'OTHER':
    case undefined:
      return affectedRows > 0 ? `${affectedRows} 件更新` : null;
  }
}

function GridStatusBarInner({
  resultSet,
  filteredRowCount,
  isFiltered,
  isReadOnly,
  connectionLabel,
  viewMode,
  transposeRowIndex,
  pagination,
  statementType,
}: GridStatusBarProps) {
  const isTranspose = viewMode === 'transpose';
  const totalRows = resultSet.rows.length;
  const affectedLabel = affectedRowsLabel(statementType, resultSet.affectedRows);

  function renderRowInfo() {
    if (isTranspose) {
      return (
        <span>
          行 {totalRows > 0 ? (transposeRowIndex ?? 0) + 1 : 0} / {totalRows}
        </span>
      );
    }

    if (pagination) {
      const totalLabel =
        pagination.totalRowCount === -1
          ? `${totalRows.toLocaleString()}+`
          : pagination.totalRowCount.toLocaleString();
      const loadingIndicator = pagination.isLoadingMore ? ' (読込中...)' : '';
      const scrollHint = pagination.hasMore ? ' - スクロールで追加読み込み' : '';

      if (isFiltered) {
        return (
          <span>
            {filteredRowCount.toLocaleString()} / {totalLabel} 件 (フィルタ中)
            {loadingIndicator}
          </span>
        );
      }
      return (
        <span>
          {totalRows.toLocaleString()} / {totalLabel} 件{loadingIndicator}
          {scrollHint}
        </span>
      );
    }

    if (resultSet.truncated) {
      return (
        <span className={styles.truncationWarning}>
          {isFiltered
            ? `⚠ ${filteredRowCount} / ${totalRows.toLocaleString()}+ 件 (フィルタ中・行数制限あり)`
            : `⚠ 先頭 ${totalRows.toLocaleString()} 件を表示（テーブルにはさらにデータがあります）`}
        </span>
      );
    }

    if (isFiltered) {
      return <span>{`${filteredRowCount} / ${totalRows} 件 (フィルタ中)`}</span>;
    }
    return <span>{totalRows} 件</span>;
  }

  return (
    <div className={styles.statusBar}>
      {connectionLabel && (
        <>
          <span>{connectionLabel}</span>
          <span className={styles.statusSeparator} />
        </>
      )}
      {renderRowInfo()}
      <span className={styles.statusSeparator} />
      <span>{resultSet.executionTimeMs.toFixed(2)} ms</span>
      {affectedLabel && (
        <>
          <span className={styles.statusSeparator} />
          <span>{affectedLabel}</span>
        </>
      )}
      {isReadOnly && <span className={styles.readOnlyIndicator}>読取専用</span>}
    </div>
  );
}

export const GridStatusBar = memo(GridStatusBarInner);
