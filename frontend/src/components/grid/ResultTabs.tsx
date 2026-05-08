import { memo } from 'react';
import type { ResultSet } from '../../types';
import styles from './ResultGrid.module.css';

interface ResultTabsProps {
  results: Array<{ statement: string; data: ResultSet }>;
  activeIndex: number;
  onSelect: (index: number) => void;
}

const MAX_TAB_LABEL_LENGTH = 50;

function ResultTabsInner({ results, activeIndex, onSelect }: ResultTabsProps) {
  return (
    <div className={styles.resultTabs}>
      {results.map((result, index) => {
        const label =
          result.statement.length > MAX_TAB_LABEL_LENGTH
            ? `${result.statement.substring(0, MAX_TAB_LABEL_LENGTH)}...`
            : result.statement;
        // statement は first-line のみなので重複し得る。実行順で固定配列のため index 併用が必要。
        const key = `${index}-${result.statement}`;
        return (
          <button
            type="button"
            key={key}
            className={`${styles.resultTab} ${activeIndex === index ? styles.activeResultTab : ''}`}
            onClick={() => onSelect(index)}
            title={result.statement}
          >
            {`[${index + 1}] ${label}`}
          </button>
        );
      })}
    </div>
  );
}

export const ResultTabs = memo(ResultTabsInner);
