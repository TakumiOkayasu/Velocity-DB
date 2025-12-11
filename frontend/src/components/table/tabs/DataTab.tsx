import { useMemo } from 'react';
import type { ResultSet } from '../../../types';
import { SimpleTable } from '../../common/SimpleTable';
import styles from '../TableViewer.module.css';

interface DataTabProps {
  resultSet: ResultSet | null;
  whereClause: string;
  onWhereClauseChange: (value: string) => void;
  onApplyFilter: () => void;
  showLogicalNames: boolean;
}

export function DataTab({
  resultSet,
  whereClause,
  onWhereClauseChange,
  onApplyFilter,
}: DataTabProps) {
  const tableColumns = useMemo(() => {
    if (!resultSet) return [];

    return [
      { field: '__rowIndex', headerName: '#', width: 60 },
      ...resultSet.columns.map((col) => ({
        field: col.name,
        headerName: col.name,
        width: '150px',
      })),
    ];
  }, [resultSet]);

  const data = useMemo(() => {
    if (!resultSet) return [];

    return resultSet.rows.map((row, idx) => {
      const obj: Record<string, unknown> = { __rowIndex: idx + 1 };
      resultSet.columns.forEach((col, colIdx) => {
        obj[col.name] = row[colIdx] ?? null;
      });
      return obj;
    });
  }, [resultSet]);

  if (!resultSet) {
    return <div className={styles.message}>No data available</div>;
  }

  return (
    <div className={styles.dataTabContainer}>
      <div className={styles.filterBar}>
        <span className={styles.filterLabel}>WHERE</span>
        <input
          type="text"
          className={styles.filterInput}
          placeholder="e.g. id > 100 AND name LIKE '%test%'"
          value={whereClause}
          onChange={(e) => onWhereClauseChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApplyFilter();
          }}
        />
        <button
          type="button"
          onClick={onApplyFilter}
          className={styles.filterButton}
          title="Apply WHERE filter (Enter)"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            onWhereClauseChange('');
            onApplyFilter();
          }}
          className={styles.filterButton}
          disabled={!whereClause}
          title="Clear filter"
        >
          Clear
        </button>
      </div>
      <div className={styles.tableWrapper}>
        <SimpleTable columns={tableColumns} data={data} />
      </div>
    </div>
  );
}
