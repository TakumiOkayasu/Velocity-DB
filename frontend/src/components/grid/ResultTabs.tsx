import { memo } from 'react';
import type { ResultSet } from '../../types';
import styles from './ResultGrid.module.css';

interface ResultTabsProps {
  results: Array<{ statement: string; data: ResultSet }>;
  activeIndex: number;
  onSelect: (index: number) => void;
}

function ResultTabsInner({ results, activeIndex, onSelect }: ResultTabsProps) {
  return (
    <div className={styles.resultTabs}>
      {results.map((result, index) => (
        <button
          key={result.statement}
          className={`${styles.resultTab} ${activeIndex === index ? styles.activeResultTab : ''}`}
          onClick={() => onSelect(index)}
          title={result.statement}
        >
          {result.statement.length > 50
            ? `${result.statement.substring(0, 50)}...`
            : result.statement}
        </button>
      ))}
    </div>
  );
}

export const ResultTabs = memo(ResultTabsInner);
