import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import type { ERTableNode } from '../../types';
import { filterTablesByQuery } from '../../utils/erDiagramUtils';
import styles from './ERDiagram.module.css';

const MAX_RESULTS = 10;

interface ERDiagramSearchProps {
  tables: ERTableNode[];
  onSelect: (table: ERTableNode) => void;
}

export function ERDiagramSearch({ tables, onSelect }: ERDiagramSearchProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    if (!deferredQuery.trim()) return [];
    return filterTablesByQuery(tables, deferredQuery).slice(0, MAX_RESULTS);
  }, [tables, deferredQuery]);

  const showDropdown = isOpen && query.trim().length > 0;

  const selectResult = useCallback(
    (table: ERTableNode) => {
      onSelect(table);
      setQuery('');
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  const keyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        selectResult(results[selectedIndex]);
      } else if (e.key === 'Escape') {
        setQuery('');
        setIsOpen(false);
        inputRef.current?.blur();
      }
    },
    [results, selectedIndex, selectResult]
  );

  const queryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
    setIsOpen(true);
  }, []);

  const focusInput = useCallback(() => setIsOpen(true), []);

  const blurInput = useCallback(() => {
    // ドロップダウンのクリックを拾うため少し遅延
    setTimeout(() => setIsOpen(false), 150);
  }, []);

  return (
    <div className={styles.searchWrapper}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={queryChange}
        onKeyDown={keyDown}
        onFocus={focusInput}
        onBlur={blurInput}
        placeholder="テーブル検索..."
        className={styles.searchInput}
      />
      {showDropdown && (
        <div className={styles.searchDropdown}>
          {results.length === 0 ? (
            <div className={styles.searchNoResults}>結果なし</div>
          ) : (
            results.map((table, index) => (
              <button
                type="button"
                key={table.id}
                className={`${styles.searchItem} ${index === selectedIndex ? styles.searchItemActive : ''}`}
                onMouseDown={() => selectResult(table)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.searchItemName}>{table.data.tableName}</span>
                {table.data.logicalName && (
                  <span className={styles.searchItemLogical}>{table.data.logicalName}</span>
                )}
                {table.data.page && (
                  <span className={styles.searchItemPage}>{table.data.page}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
