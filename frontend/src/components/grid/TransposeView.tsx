import { memo, useCallback, useState } from 'react';
import type { ColumnMeta, RowData } from '../../types/grid';
import { isNumericType } from '../../types/grid';
import styles from './TransposeView.module.css';

interface TransposeViewProps {
  columns: ColumnMeta[];
  rowData: RowData[];
  currentRowIndex: number;
  showLogicalNames: boolean;
  onNavigate: (index: number) => void;
}

function TransposeViewInner({
  columns,
  rowData,
  currentRowIndex,
  showLogicalNames,
  onNavigate,
}: TransposeViewProps) {
  const [inputValue, setInputValue] = useState('');

  const totalRows = rowData.length;
  const currentRow = totalRows > 0 ? rowData[currentRowIndex] : null;
  const isFirst = currentRowIndex <= 0;
  const isLast = currentRowIndex >= totalRows - 1;

  const navigatePrev = useCallback(() => {
    if (currentRowIndex > 0) onNavigate(currentRowIndex - 1);
  }, [currentRowIndex, onNavigate]);

  const navigateNext = useCallback(() => {
    if (currentRowIndex < totalRows - 1) onNavigate(currentRowIndex + 1);
  }, [currentRowIndex, totalRows, onNavigate]);

  const commitInput = useCallback(() => {
    const parsed = Number.parseInt(inputValue, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= totalRows) {
      onNavigate(parsed - 1);
    }
    setInputValue('');
  }, [inputValue, totalRows, onNavigate]);

  const inputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commitInput();
    },
    [commitInput]
  );

  if (totalRows === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>データがありません</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.navigation}>
        <button
          type="button"
          className={styles.navButton}
          disabled={isFirst}
          onClick={navigatePrev}
          title="前の行"
        >
          ◀
        </button>
        <span className={styles.navLabel}>行</span>
        <input
          type="text"
          className={styles.navInput}
          value={inputValue || String(currentRowIndex + 1)}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitInput}
          onKeyDown={inputKeyDown}
          onFocus={() => setInputValue(String(currentRowIndex + 1))}
        />
        <span className={styles.navLabel}>/ {totalRows}</span>
        <button
          type="button"
          className={styles.navButton}
          disabled={isLast}
          onClick={navigateNext}
          title="次の行"
        >
          ▶
        </button>
      </div>

      <div className={styles.scrollContainer}>
        <table className={styles.table}>
          <tbody>
            {columns.map((col) => {
              const value = currentRow?.[col.name] ?? null;
              const isNull = value === null;
              const isNumeric = isNumericType(col.type);
              const displayName = showLogicalNames && col.comment ? col.comment : col.name;

              return (
                <tr key={col.name} className={styles.row}>
                  <td className={styles.columnName}>
                    {displayName}
                    <span className={styles.columnType}>{col.type}</span>
                  </td>
                  <td
                    className={[
                      styles.value,
                      isNull && styles.nullCell,
                      isNumeric && !isNull && styles.numericValue,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {isNull ? 'NULL' : value}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const TransposeView = memo(TransposeViewInner);
