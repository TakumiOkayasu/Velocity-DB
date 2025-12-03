import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';
import type { Column } from '../../types';
import styles from './TableNode.module.css';

interface TableNodeData {
  tableName: string;
  columns: Column[];
}

interface TableNodeProps {
  data: TableNodeData;
  selected?: boolean;
}

// Unicode icons
const icons = {
  table: '\uD83D\uDCCB', // 📋
  key: '\uD83D\uDD11', // 🔑
};

export const TableNode = memo(function TableNode({ data, selected }: TableNodeProps) {
  const { tableName, columns } = data;

  const primaryKeys = columns.filter((c) => c.isPrimaryKey);
  const regularColumns = columns.filter((c) => !c.isPrimaryKey);

  return (
    <div className={`${styles.container} ${selected ? styles.selected : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />

      <div className={styles.header}>
        <span className={styles.icon}>{icons.table}</span>
        <span className={styles.tableName}>{tableName}</span>
      </div>

      <div className={styles.columns}>
        {primaryKeys.map((col) => (
          <div key={col.name} className={`${styles.column} ${styles.primaryKey}`}>
            <span className={styles.keyIcon}>{icons.key}</span>
            <span className={styles.columnName}>{col.name}</span>
            <span className={styles.columnType}>{col.type}</span>
          </div>
        ))}

        {primaryKeys.length > 0 && regularColumns.length > 0 && <div className={styles.divider} />}

        {regularColumns.slice(0, 10).map((col) => (
          <div key={col.name} className={styles.column}>
            <span className={styles.columnName}>
              {col.nullable ? '' : '*'}
              {col.name}
            </span>
            <span className={styles.columnType}>{col.type}</span>
          </div>
        ))}

        {regularColumns.length > 10 && (
          <div className={styles.moreColumns}>+{regularColumns.length - 10} more columns</div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
});
