import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import styles from './SearchDialog.module.css';

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onResultSelect: (result: SearchResult) => void;
}

interface SearchResult {
  type: 'table' | 'view' | 'procedure' | 'function' | 'column';
  name: string;
  schema: string;
  parentName?: string;
  database: string;
}

export function SearchDialog({ isOpen, onClose, onResultSelect }: SearchDialogProps) {
  const { activeConnectionId, connections } = useConnectionStore();
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const isStale = searchQuery !== deferredSearchQuery;

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setSearchQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search when deferred query changes (prevents blocking UI during typing)
  useEffect(() => {
    if (!deferredSearchQuery.trim() || !activeConnectionId) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const doSearch = async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchObjects(activeConnectionId, deferredSearchQuery);
        if (!cancelled) {
          setResults(searchResults);
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error('Search failed:', err);
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    };

    doSearch();
    return () => {
      cancelled = true;
    };
  }, [deferredSearchQuery, activeConnectionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        onResultSelect(results[selectedIndex]);
        onClose();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIndex, onResultSelect, onClose]
  );

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onResultSelect(result);
      onClose();
    },
    [onResultSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchContainer}>
          <span className={styles.searchIcon}>{'\uD83D\uDD0D'}</span>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tables, views, procedures..."
            className={styles.searchInput}
          />
          {(isSearching || isStale) && <span className={styles.spinner}>{'\u23F3'}</span>}
        </div>

        <div className={styles.results}>
          {!activeConnectionId ? (
            <div className={styles.noConnection}>Connect to a database to search</div>
          ) : results.length === 0 && searchQuery.trim() ? (
            <div className={styles.noResults}>
              {isSearching || isStale ? 'Searching...' : 'No results found'}
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={`${result.type}-${result.schema}-${result.name}`}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => handleResultClick(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.resultIcon}>{getIcon(result.type)}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>
                    {result.parentName ? `${result.parentName}.` : ''}
                    {result.name}
                  </span>
                  <span className={styles.resultMeta}>
                    {result.schema}.{result.type}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>↑↓ to navigate, Enter to select, Esc to close</span>
          {activeConnection && (
            <span className={styles.connectionInfo}>{activeConnection.database}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function getIcon(type: SearchResult['type']): string {
  switch (type) {
    case 'table':
      return '\uD83D\uDCCB'; // 📋
    case 'view':
      return '\uD83D\uDC41'; // 👁
    case 'procedure':
      return '\u2699\uFE0F'; // ⚙️
    case 'function':
      return '\u0192'; // ƒ
    case 'column':
      return '\u2502'; // │
    default:
      return '\uD83D\uDCC4'; // 📄
  }
}

async function searchObjects(connectionId: string, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  try {
    // Get tables and filter locally (simplified approach)
    // In a real implementation, this would be a server-side search
    const { tables } = await bridge.getTables(connectionId, '');

    for (const table of tables) {
      if (table.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: table.type === 'VIEW' ? 'view' : 'table',
          name: table.name,
          schema: table.schema,
          database: '',
        });
      }
    }

    // Limit results
    return results.slice(0, 50);
  } catch (err) {
    console.error('Search error:', err);
    return [];
  }
}
