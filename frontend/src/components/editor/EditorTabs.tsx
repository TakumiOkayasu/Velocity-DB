import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useQueries, useQueryActions, useQueryStore } from '../../store/queryStore';
import type { Query } from '../../types';
import { connectionColor } from '../../utils/colorContrast';
import { stripBrackets } from '../../utils/stringUtils';
import styles from './EditorTabs.module.css';

// SQL file icon
const SqlIcon = (
  <svg
    className={styles.tabIcon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    aria-hidden="true"
  >
    <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
    <path d="M9 1v4h4" />
  </svg>
);

// ER diagram icon
const ERDiagramIcon = (
  <svg
    className={styles.tabIcon}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    aria-hidden="true"
  >
    <rect x="1" y="1" width="5" height="4" rx="0.5" />
    <rect x="10" y="1" width="5" height="4" rx="0.5" />
    <rect x="5.5" y="11" width="5" height="4" rx="0.5" />
    <path d="M3.5 5v3.5h4.5V11" />
    <path d="M12.5 5v3.5h-4.5V11" />
  </svg>
);

// Plus icon for add button
const PlusIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

// Close icon
const CloseIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

type ConnectionColorMap = Record<string, { color: string; label: string }>;

function buildTooltip(query: Query, envMap: ConnectionColorMap): string {
  const parts = [stripBrackets(query.name)];
  if (query.logicalName) {
    parts.push(query.logicalName);
  } else if (query.isDataView && query.sourceTable && query.sourceTable !== query.name) {
    parts.push(stripBrackets(query.sourceTable));
  }
  if (query.connectionId) {
    const entry = envMap[query.connectionId];
    if (entry) {
      parts.push(`接続先: ${entry.label}`);
    }
  }
  return parts.join('\n');
}

export function EditorTabs() {
  const queries = useQueries();
  const activeQueryId = useQueryStore((state) => state.activeQueryId);
  const connections = useConnectionStore((s) => s.connections);
  const connectionColorMap: ConnectionColorMap = useMemo(
    () =>
      Object.fromEntries(
        connections.map((c) => [
          c.id,
          {
            color: connectionColor(c.server, c.database),
            label: `${c.server}/${c.database}`,
          },
        ])
      ),
    [connections]
  );
  const { addQuery, removeQuery, setActive, reorderQuery, openERDiagram } = useQueryActions();

  // Ctrl+W: close active tab
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (activeQueryId) removeQuery(activeQueryId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeQueryId, removeQuery]);
  const activeQuery = queries.find((q) => q.id === activeQueryId);
  const activeQueryConnectionId = activeQuery?.connectionId ?? null;

  const tabsRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const checkOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, []);

  // ResizeObserver + scroll で溢れ検知
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    el.addEventListener('scroll', checkOverflow);

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', checkOverflow);
    };
  }, [checkOverflow]);

  // タブ数変更時に溢れ再チェック
  // biome-ignore lint/correctness/useExhaustiveDependencies: queries.length is intentional to recheck overflow on tab count change
  useEffect(() => {
    checkOverflow();
  }, [queries.length, checkOverflow]);

  // メニュー外クリックで閉じる（各メニュー独立）
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node))
        setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addMenuOpen]);

  // --- DnD handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex !== null && dragIndex !== index) {
        setDropTarget(index);
      }
    },
    [dragIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        reorderQuery(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex, reorderQuery]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropTarget(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const createERDiagram = useCallback(() => {
    const existingNames = new Set(queries.filter((q) => q.isERDiagram).map((q) => q.name));
    let idx = 1;
    let name = 'ER図';
    while (existingNames.has(name)) {
      idx++;
      name = `ER図 ${idx}`;
    }
    openERDiagram(name);
    setAddMenuOpen(false);
  }, [queries, openERDiagram]);

  return (
    <div role="toolbar" className={styles.container}>
      <div className={styles.tabs} ref={tabsRef} role="tablist">
        {queries.map((query, index) => {
          const connColor = query.connectionId
            ? connectionColorMap[query.connectionId]?.color
            : undefined;
          const isDragging = dragIndex === index;
          const isDropTarget = dropTarget === index;

          const className = [
            styles.tab,
            query.id === activeQueryId && styles.active,
            isDragging && styles.dragging,
            isDropTarget && styles.dropTarget,
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={query.id}
              className={className}
              style={
                connColor
                  ? ({
                      '--connection-color': connColor,
                    } as React.CSSProperties)
                  : undefined
              }
              role="tab"
              tabIndex={0}
              onClick={() => setActive(query.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive(query.id);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  removeQuery(query.id);
                }
              }}
              title={buildTooltip(query, connectionColorMap)}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              {query.isERDiagram ? ERDiagramIcon : SqlIcon}
              <span className={styles.tabName}>
                {query.isDirty && <span className={styles.dirty}>●</span>}
                {stripBrackets(query.name)}
              </span>
              <button
                type="button"
                className={styles.closeButton}
                onClick={(e) => {
                  e.stopPropagation();
                  removeQuery(query.id);
                }}
                title="タブを閉じる"
              >
                {CloseIcon}
              </button>
            </div>
          );
        })}
      </div>
      {isOverflowing && (
        <div className={styles.overflowMenuWrapper} ref={menuRef}>
          <button
            type="button"
            className={styles.overflowButton}
            onClick={() => setMenuOpen((prev) => !prev)}
            title="全タブ一覧"
          >
            ▾
          </button>
          {menuOpen && (
            <div className={styles.overflowMenu}>
              {queries.map((query) => (
                <button
                  type="button"
                  key={query.id}
                  className={`${styles.overflowMenuItem} ${query.id === activeQueryId ? styles.activeItem : ''}`}
                  onClick={() => {
                    setActive(query.id);
                    setMenuOpen(false);
                  }}
                >
                  {query.isERDiagram ? ERDiagramIcon : SqlIcon}
                  <span className={styles.overflowMenuItemName}>{stripBrackets(query.name)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={styles.addMenuWrapper} ref={addMenuRef}>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setAddMenuOpen((prev) => !prev)}
          title="新規タブ (Ctrl+N)"
        >
          {PlusIcon}
        </button>
        {addMenuOpen && (
          <div className={styles.overflowMenu}>
            <button
              type="button"
              className={styles.overflowMenuItem}
              onClick={() => {
                addQuery(activeQueryConnectionId);
                setAddMenuOpen(false);
              }}
            >
              {SqlIcon}
              <span>新規クエリ</span>
            </button>
            <button type="button" className={styles.overflowMenuItem} onClick={createERDiagram}>
              {ERDiagramIcon}
              <span>新規ER図</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
